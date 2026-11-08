import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createApplication} from '../dist-node/application.mjs';

test('authenticated partners can play a shared truth-or-dare game through every state', async t => {
  const dataDir=await mkdtemp(resolve(tmpdir(),'couple-truth-dare-'));
  const origin='http://127.0.0.1:32139';
  const app=createApplication({root:resolve('dist-node'),dataDir,origin});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true})});
  const call=(path,{method='GET',cookie='',body}={})=>app.dispatch(new Request(origin+path,{
    method,
    headers:{
      ...(cookie?{Cookie:cookie}:{}),
      ...(!['GET','HEAD'].includes(method)?{Origin:origin,'Content-Type':'application/json'}:{}),
    },
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  }));
  const setup=await call('/api/setup',{method:'POST',body:{
    passwords:['P1-secret-test-2026','P2-secret-test-2026'],
    confirmations:['P1-secret-test-2026','P2-secret-test-2026'],
  }});
  assert.equal(setup.status,200,await setup.clone().text());
  const p1=setup.headers.get('set-cookie').split(';')[0];
  const login=await call('/api/auth',{method:'POST',body:{slot:2,password:'P2-secret-test-2026'}});
  assert.equal(login.status,200,await login.clone().text());
  const p2=login.headers.get('set-cookie').split(';')[0];
  const root='/api/games/truth-dare';
  assert.equal((await call(`${root}/active`)).status,401);
  assert.deepEqual((await (await call(`${root}/active`,{cookie:p1})).json()).game,null);

  const created=await call(root,{method:'POST',cookie:p1,body:{}});
  assert.equal(created.status,201,await created.clone().text());
  const first=(await created.json()).game;
  assert.equal(first.status,'waiting_p1_roll');
  assert.equal(first.role,'p1');
  assert.equal((await call(root,{method:'POST',cookie:p2,body:{}})).status,200);
  assert.equal((await (await call(`${root}/active`,{cookie:p2})).json()).game.id,first.id);
  assert.equal((await call(`${root}/${first.id}/roll`,{method:'POST',cookie:p1,body:{roll:7}})).status,400);

  const p1Roll=await call(`${root}/${first.id}/roll`,{method:'POST',cookie:p1,body:{roll:2}});
  assert.equal(p1Roll.status,200,await p1Roll.clone().text());
  assert.equal((await p1Roll.json()).game.status,'waiting_p2_roll');
  assert.equal((await call(`${root}/${first.id}/roll`,{method:'POST',cookie:p1,body:{roll:6}})).status,403);
  const visibleToP2=(await (await call(`${root}/active`,{cookie:p2})).json()).game;
  assert.equal(visibleToP2.p1Roll,2);
  assert.equal(visibleToP2.status,'waiting_p2_roll');

  const p2Roll=await call(`${root}/${first.id}/roll`,{method:'POST',cookie:p2,body:{roll:5}});
  assert.equal(p2Roll.status,200,await p2Roll.clone().text());
  const lost=(await p2Roll.json()).game;
  assert.equal(lost.status,'waiting_loser_choice');
  assert.equal(lost.isLoser,false);
  assert.equal(lost.isWinner,true);
  assert.equal((await call(`${root}/${first.id}/choice`,{method:'POST',cookie:p2,body:{choiceType:'truth'}})).status,403);
  const chosen=await call(`${root}/${first.id}/choice`,{method:'POST',cookie:p1,body:{choiceType:'truth'}});
  assert.equal(chosen.status,200,await chosen.clone().text());
  assert.equal((await chosen.json()).game.status,'waiting_winner_question');
  assert.equal((await call(`${root}/${first.id}/question`,{method:'POST',cookie:p1,body:{questionText:'题目'}})).status,403);
  const finished=await call(`${root}/${first.id}/question`,{method:'POST',cookie:p2,body:{questionText:'你最喜欢我们一起做的哪件小事？'}});
  assert.equal(finished.status,200,await finished.clone().text());
  assert.equal((await finished.json()).game.status,'finished');
  for(const cookie of [p1,p2]){
    const finalGame=(await (await call(`${root}/active`,{cookie})).json()).game;
    assert.equal(finalGame.status,'finished');
    assert.equal(finalGame.questionText,'你最喜欢我们一起做的哪件小事？');
  }
  assert.equal((await call(`${root}/${first.id}/question`,{method:'POST',cookie:p2,body:{questionText:'重复提交'}})).status,409);

  const tieCreated=await call(root,{method:'POST',cookie:p2,body:{}});
  assert.equal(tieCreated.status,201,await tieCreated.clone().text());
  const tie=(await tieCreated.json()).game;
  await call(`${root}/${tie.id}/roll`,{method:'POST',cookie:p2,body:{roll:4}});
  const tieResult=await call(`${root}/${tie.id}/roll`,{method:'POST',cookie:p1,body:{roll:4}});
  assert.equal(tieResult.status,200,await tieResult.clone().text());
  assert.equal((await tieResult.json()).game.status,'waiting_p1_roll');
  const reroll=await call(`${root}/${tie.id}/roll`,{method:'POST',cookie:p1,body:{roll:1}});
  assert.equal(reroll.status,403);
  const rerolledP1=await call(`${root}/${tie.id}/roll`,{method:'POST',cookie:p2,body:{roll:6}});
  assert.equal(rerolledP1.status,200);
  const finalTieRound=await call(`${root}/${tie.id}/roll`,{method:'POST',cookie:p1,body:{roll:3}});
  assert.equal(finalTieRound.status,200,await finalTieRound.clone().text());
  assert.equal((await finalTieRound.json()).game.status,'waiting_loser_choice');

  assert.equal((await call(`${root}/${tie.id}/choice`,{method:'POST',cookie:p1,body:{choiceType:'dare'}})).status,200);
  assert.equal((await call(`${root}/${tie.id}/question`,{method:'POST',cookie:p2,body:{questionText:'   '}})).status,400);
  const tooLong=await call(`${root}/${tie.id}/question`,{method:'POST',cookie:p2,body:{questionText:'题'.repeat(301)}});
  assert.equal(tooLong.status,400);
});
