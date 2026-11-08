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

test('two dice ties can reroll and a winner can draw, change, or customize a prompt', () => {
  const start = features.indexOf('const truthDareQuestions=');
  const end = features.indexOf('// Hash routes keep each room', start);
  const selectors = [
    '#truth-dare-player-1','#truth-dare-player-2','#truth-dare-die-1','#truth-dare-die-2',
    '#truth-dare-roll','#truth-dare-types','#truth-dare-challenge','#truth-dare-status',
    '#truth-dare-truth','#truth-dare-dare','#truth-dare-kind','#truth-dare-question',
    '#truth-dare-result','#truth-dare-change','#truth-dare-custom','#truth-dare-custom-note',
    '#truth-dare-custom-send','#modal'
  ];
  const nodes = Object.fromEntries(selectors.map(selector=>[selector,{
    textContent:'',value:'',hidden:false,disabled:false,open:true,onclick:null,attributes:{},
    classList:{add(){},remove(){}},setAttribute(name,value){this.attributes[name]=value}
  }]));
  const rolls=[0,0,.99,.2,.2,.5];
  const context=vm.createContext({
    window:{},document:{addEventListener(){}},Element:function(){},
    $:selector=>nodes[selector]||(selector==='#modal'?{open:true}:undefined),needReady:()=>true,me:{slot:1},state:{names:['我','TA']},
    modal:(_title,html)=>{nodes['#modal'].open=true;context.modalHtml=html},
    Math:{random:()=>rolls.shift(),floor:Math.floor},setTimeout:callback=>callback()
  });
  vm.runInContext(features.slice(start,end),context);
  context.window.LittleDaysTruthDare.open();
  assert.match(context.modalHtml,/truth-dare-die-1/);
  assert.match(context.modalHtml,/truth-dare-die-2/);
  nodes['#truth-dare-roll'].onclick();
  assert.match(nodes['#truth-dare-status'].textContent,/平局.*再掷一次/);
  assert.equal(nodes['#truth-dare-types'].hidden,true);
  nodes['#truth-dare-roll'].onclick();
  assert.equal(nodes['#truth-dare-die-1'].textContent,'⚅');
  assert.equal(nodes['#truth-dare-die-2'].textContent,'⚁');
  assert.match(nodes['#truth-dare-status'].textContent,/你赢了/);
  assert.equal(nodes['#truth-dare-types'].hidden,false);
  nodes['#truth-dare-truth'].onclick();
  assert.equal(nodes['#truth-dare-kind'].textContent,'💬 真心话');
  const systemQuestion=nodes['#truth-dare-question'].textContent;
  assert.ok(systemQuestion);
  nodes['#truth-dare-custom'].value='讲一讲最想重来的约会';
  nodes['#truth-dare-custom-send'].onclick();
  assert.equal(nodes['#truth-dare-question'].textContent,'讲一讲最想重来的约会');
  assert.equal(nodes['#truth-dare-kind'].textContent,'✍️ 自定义出题');
  nodes['#truth-dare-change'].onclick();
  assert.equal(nodes['#truth-dare-kind'].textContent,'💬 真心话');
  assert.notEqual(nodes['#truth-dare-question'].textContent,systemQuestion);
  nodes['#truth-dare-custom'].value='   ';
  nodes['#truth-dare-custom-send'].onclick();
  assert.match(nodes['#truth-dare-custom-note'].textContent,/先写下/);
});

test('service worker cache version and resource URLs are refreshed', () => {
  assert.match(sw, /couple-home-v10/);
  assert.match(sw, /style\.css\?v=20261108-truth-duel/);
  assert.match(sw, /app\.js\?v=20261108-truth-duel/);
  assert.match(sw, /features\.js\?v=20261108-truth-duel/);
});
