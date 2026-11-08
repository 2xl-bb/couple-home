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
  assert.deepEqual(first.chatMessages,[]);
  assert.equal((await call(root,{method:'POST',cookie:p2,body:{}})).status,200);
  assert.equal((await (await call(`${root}/active`,{cookie:p2})).json()).game.id,first.id);
  const firstMessage={messageId:'11111111-1111-4111-8111-111111111111',text:'你先掷，别紧张 😉'};
  const sent=await call(`${root}/${first.id}/chat`,{method:'POST',cookie:p1,body:firstMessage});
  assert.equal(sent.status,201,await sent.clone().text());
  const sentGame=(await sent.json()).game;
  assert.equal(sentGame.chatMessages.length,1);
  assert.deepEqual({...sentGame.chatMessages[0],timestamp:undefined},{id:firstMessage.messageId,senderRole:'p1',text:firstMessage.text,timestamp:undefined});
  assert.ok(Number.isSafeInteger(sentGame.chatMessages[0].timestamp));
  const partnerView=(await (await call(`${root}/active`,{cookie:p2})).json()).game;
  assert.equal(partnerView.chatMessages[0].senderRole,'p1');
  const secondMessage={messageId:'22222222-2222-4222-8222-222222222222',text:'我准备好了！'};
  const partnerSent=await call(`${root}/${first.id}/chat`,{method:'POST',cookie:p2,body:secondMessage});
  assert.equal(partnerSent.status,201,await partnerSent.clone().text());
  assert.equal((await partnerSent.json()).game.chatMessages[1].senderRole,'p2');
  const retried=await call(`${root}/${first.id}/chat`,{method:'POST',cookie:p2,body:secondMessage});
  assert.equal(retried.status,200,await retried.clone().text());
  assert.equal((await retried.json()).game.chatMessages.length,2);
  const simultaneous=await Promise.all([
    call(`${root}/${first.id}/chat`,{method:'POST',cookie:p1,body:{messageId:'55555555-5555-4555-8555-555555555555',text:'我再补一句'}}),
    call(`${root}/${first.id}/chat`,{method:'POST',cookie:p2,body:{messageId:'66666666-6666-4666-8666-666666666666',text:'我也听着呢'}}),
  ]);
  for(const response of simultaneous)assert.equal(response.status,201,await response.clone().text());
  assert.equal((await (await call(`${root}/active`,{cookie:p2})).json()).game.chatMessages.length,4);
  assert.equal((await call(`${root}/${first.id}/chat`,{method:'POST',cookie:p2,body:{...secondMessage,messageId:'bad-id'}})).status,400);
  assert.equal((await call(`${root}/${first.id}/chat`,{method:'POST',cookie:p2,body:{messageId:'33333333-3333-4333-8333-333333333333',text:'消息'.repeat(251)}})).status,400);
  assert.equal((await call(`${root}/${first.id}/chat`,{method:'POST',body:{...secondMessage,messageId:'44444444-4444-4444-8444-444444444444'}})).status,401);
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
  assert.equal((await finished.json()).game.status,'waiting_loser_answer');
  assert.equal((await call(`${root}/${first.id}/answer`,{method:'POST',cookie:p2,body:{answerText:'赢家不能代答'}})).status,403);
  assert.equal((await call(`${root}/${first.id}/answer`,{method:'POST',cookie:p1,body:{answerText:'   '}})).status,400);
  assert.equal((await call(`${root}/${first.id}/answer`,{method:'POST',cookie:p1,body:{answerText:'答'.repeat(1001)}})).status,400);
  const answer=await call(`${root}/${first.id}/answer`,{method:'POST',cookie:p1,body:{answerText:'最喜欢一起散步，也最喜欢你分享沿途看到的小事。'}});
  assert.equal(answer.status,200,await answer.clone().text());
  assert.equal((await answer.json()).game.status,'finished');
  for(const cookie of [p1,p2]){
    const finalGame=(await (await call(`${root}/active`,{cookie})).json()).game;
    assert.equal(finalGame.status,'finished');
    assert.equal(finalGame.questionText,'你最喜欢我们一起做的哪件小事？');
    assert.equal(finalGame.answerText,'最喜欢一起散步，也最喜欢你分享沿途看到的小事。');
    assert.equal(finalGame.chatMessages.length,4);
  }
  assert.equal((await call(`${root}/${first.id}/answer`,{method:'POST',cookie:p1,body:{answerText:'重复提交'}})).status,409);

  const tieCreated=await call(root,{method:'POST',cookie:p2,body:{}});
  assert.equal(tieCreated.status,201,await tieCreated.clone().text());
  const tie=(await tieCreated.json()).game;
  assert.deepEqual(tie.chatMessages,[]);
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
