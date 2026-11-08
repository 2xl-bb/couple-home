import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const [app, html, css, features, sw] = await Promise.all([
  readFile('public/app.js', 'utf8'),
  readFile('app/home.html', 'utf8'),
  readFile('public/style.css', 'utf8'),
  readFile('public/features.js', 'utf8'),
  readFile('public/sw.js', 'utf8')
]);

test('startup stays on the loading screen until authentication succeeds or rejects', () => {
  assert.match(html, /class="home-locked auth-checking"/);
  assert.match(html, /id="auth-loading"/);
  assert.match(css, /body\.auth-checking \.login-gate\{display:none!important\}/);
  assert.match(app, /let state=empty\(\).*isAuthChecking=true/);
  assert.match(app, /document\.body\.classList\.remove\('home-locked','auth-checking'\)/);
});

test('the pet destination is hidden and the former navigation slot opens the game', () => {
  assert.match(features, /#room-picker option\[value="pet"\]/);
  assert.match(features, /header nav a\[href="#\/pet"\]/);
  assert.match(features, /gameNav\.dataset\.openTruthDare=''/);
  assert.match(features, /gameDock\.dataset\.openTruthDare=''/);
  assert.match(features, /const titles=\{home:/);
  assert.doesNotMatch(features.slice(features.indexOf('const titles='), features.indexOf('const main=')), /pet:/);
});

test('the game polls the shared API and renders each role-specific stage', () => {
  const start = features.indexOf('const truthDareQuestions=');
  const end = features.indexOf('async function truthDareRefresh(', start);
  const selectors = [
    '#truth-dare-start','#truth-dare-board','#truth-dare-die-1','#truth-dare-die-2',
    '#truth-dare-roll','#truth-dare-types','#truth-dare-challenge','#truth-dare-status','#truth-dare-waiting',
    '#truth-dare-kind','#truth-dare-question','#truth-dare-result','#truth-dare-change','#truth-dare-custom',
    '#truth-dare-custom-label','#truth-dare-custom-send','#truth-dare-submit-system','#truth-dare-note'
  ];
  const nodes = Object.fromEntries(selectors.map(selector=>[selector,{
    textContent:'',value:'',hidden:false,disabled:false,attributes:{},
    setAttribute(name,value){this.attributes[name]=value}
  }]));
  const context=vm.createContext({
    window:{},truthDareCurrent:null,truthDareQuestionKey:'',truthDareQuestionDraft:'',
    $:selector=>nodes[selector],me:{slot:1},Math:{random:()=>.4,floor:Math.floor}
  });
  vm.runInContext(features.slice(start,end),context);
  const render=game=>context.truthDareShowGame(game);
  const base={id:'game',p1Roll:5,p2Roll:null,choiceType:null,questionText:null};
  render({...base,status:'waiting_p1_roll',role:'p1'});
  assert.equal(nodes['#truth-dare-roll'].hidden,false);
  render({...base,status:'waiting_p1_roll',role:'p2'});
  assert.equal(nodes['#truth-dare-roll'].hidden,true);
  assert.match(nodes['#truth-dare-waiting'].textContent,/等待 TA 掷骰子/);
  render({...base,p2Roll:5,status:'waiting_p1_roll',role:'p1'});
  assert.match(nodes['#truth-dare-status'].textContent,/平局/);
  render({...base,p2Roll:2,status:'waiting_loser_choice',role:'p2',isLoser:true,isWinner:false});
  assert.equal(nodes['#truth-dare-types'].hidden,false);
  render({...base,p2Roll:2,status:'waiting_loser_choice',role:'p1',isLoser:false,isWinner:true});
  assert.match(nodes['#truth-dare-waiting'].textContent,/等待 TA 选择惩罚/);
  render({...base,p2Roll:2,status:'waiting_winner_question',role:'p1',isLoser:false,isWinner:true,choiceType:'truth'});
  assert.equal(nodes['#truth-dare-challenge'].hidden,false);
  assert.equal(nodes['#truth-dare-kind'].textContent,'💬 真心话');
  assert.ok(nodes['#truth-dare-question'].textContent);
  render({...base,p2Roll:2,status:'waiting_winner_question',role:'p2',isLoser:true,isWinner:false,choiceType:'truth'});
  assert.match(nodes['#truth-dare-waiting'].textContent,/等待 TA 出题/);
  render({...base,p2Roll:2,status:'finished',role:'p2',isLoser:true,isWinner:false,choiceType:'dare',questionText:'最终题目'});
  assert.equal(nodes['#truth-dare-question'].textContent,'最终题目');
  assert.equal(nodes['#truth-dare-start'].hidden,false);
  assert.equal(nodes['#truth-dare-start'].textContent,'开启下一局 ↻');
  for(const endpoint of ['/api/games/truth-dare/active','/roll','/choice','/question'])assert.ok(features.includes(endpoint),endpoint);
  assert.match(features,/setInterval\(\(\)=>truthDareRefresh\(session\),3000\)/);
});

test('service worker cache version and resource URLs are refreshed', () => {
  assert.match(sw, /couple-home-v11/);
  assert.match(sw, /style\.css\?v=20261108-truth-cloud/);
  assert.match(sw, /app\.js\?v=20261108-truth-cloud/);
  assert.match(sw, /features\.js\?v=20261108-truth-cloud/);
});
