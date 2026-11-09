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

test('the pet destination is gone and the truth-or-dare entry replaced it', () => {
  // 宠物模块在 c5b7175 整体移除，连带 gameNav / gameDock 的导航映射也不存在了；
  // 这里只保留「宠物入口确实没了、真心话入口确实在」这两个仍成立的事实。
  assert.doesNotMatch(html, /option value="pet"/);
  assert.doesNotMatch(html, /href="#\/pet"/);
  assert.match(html, /data-open-truth-dare/);
  assert.match(features, /const titles=\{home:/);
  assert.doesNotMatch(features.slice(features.indexOf('const titles='), features.indexOf('const main=')), /pet:/);
});

test('the game receives SSE updates and renders each role-specific stage', () => {
  const start = features.indexOf('const truthDareQuestions=');
  const end = features.indexOf('async function truthDareRefresh(', start);
  const selectors = [
    '#truth-dare-start','#truth-dare-board','#truth-dare-die-1','#truth-dare-die-2',
    '#truth-dare-roll','#truth-dare-types','#truth-dare-challenge','#truth-dare-status','#truth-dare-waiting',
    '#truth-dare-kind','#truth-dare-question','#truth-dare-result','#truth-dare-change','#truth-dare-custom',
    '#truth-dare-custom-label','#truth-dare-custom-send','#truth-dare-submit-system','#truth-dare-note',
    '#truth-dare-answer-section','#truth-dare-answer-input','#truth-dare-answer-submit',
    '#truth-dare-answer-result','#truth-dare-answer-text','#truth-dare-answer-label',
    '#truth-dare-chat-list','#truth-dare-chat-form','#truth-dare-chat-input','#truth-dare-chat-send','#truth-dare-save-todo'
  ];
  const nodes = Object.fromEntries(selectors.map(selector=>[selector,{
    textContent:'',value:'',hidden:false,disabled:false,attributes:{},children:[],scrollHeight:100,scrollTop:0,
    setAttribute(name,value){this.attributes[name]=value},
    append(...children){this.children.push(...children)},
    replaceChildren(...children){this.children=children}
  }]));
  const context=vm.createContext({
    window:{},truthDareCurrent:null,truthDareQuestionKey:'',truthDareQuestionDraft:'',state:{names:['阿晴','小宇']},
    $:selector=>nodes[selector],me:{slot:1},Math:{random:()=>.4,floor:Math.floor},
    document:{createElement:()=>({append(){},className:'',textContent:'',children:[],append(...children){this.children.push(...children)}})}
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
  render({...base,p2Roll:2,status:'waiting_loser_answer',role:'p1',isLoser:true,isWinner:false,choiceType:'dare',questionText:'最终题目'});
  assert.equal(nodes['#truth-dare-answer-input'].hidden,false);
  render({...base,p2Roll:2,status:'waiting_loser_answer',role:'p2',isLoser:false,isWinner:true,choiceType:'dare',questionText:'最终题目'});
  assert.match(nodes['#truth-dare-status'].textContent,/等待 TA 作答/);
  assert.equal(nodes['#truth-dare-answer-input'].hidden,true);
  render({...base,p2Roll:2,status:'finished',role:'p2',isLoser:false,isWinner:true,choiceType:'dare',questionText:'最终题目',answerText:'最终回答'});
  assert.equal(nodes['#truth-dare-question'].textContent,'最终题目');
  assert.equal(nodes['#truth-dare-answer-text'].textContent,'最终回答');
  assert.equal(nodes['#truth-dare-answer-result'].hidden,false);
  assert.equal(nodes['#truth-dare-start'].hidden,false);
  assert.equal(nodes['#truth-dare-start'].textContent,'开启下一局 ↻');
  render({...base,status:'finished',role:'p1',chatMessages:[
    {id:'m1',senderRole:'p1',text:'我这边先掷！',timestamp:1000},
    {id:'m2',senderRole:'p2',text:'好呀，等我一下',timestamp:2000}
  ]});
  const bubbles=nodes['#truth-dare-chat-list'].children;
  assert.equal(bubbles.length,2);
  assert.equal(bubbles[0].className,'truth-dare-chat-message is-mine');
  assert.equal(bubbles[0].children[1].textContent,'我这边先掷！');
  assert.equal(bubbles[1].className,'truth-dare-chat-message is-theirs');
  assert.equal(bubbles[0].children[0].textContent,'阿晴');
  assert.equal(bubbles[1].children[0].textContent,'小宇');
  assert.equal(nodes['#truth-dare-chat-list'].scrollTop,100);
  assert.equal(nodes['#truth-dare-chat-form'].hidden,false);
  for(const endpoint of ['/api/games/truth-dare/active','/roll','/choice','/question','/answer','/chat'])assert.ok(features.includes(endpoint),endpoint);
  assert.match(features,/truthDareChatPending\.push\(message\)/);
  render({...base,status:'finished',role:'p1',choiceType:'dare',questionText:'选一首歌',chatMessages:[]});
  assert.equal(nodes['#truth-dare-save-todo'].hidden,false);
  assert.equal(nodes['#truth-dare-save-todo'].textContent,'存入待办 · 稍后完成');
  assert.match(features,/api\('\/api\/games\/truth-dare\/todos'/);
  assert.match(features,/api\(`\/api\/games\/truth-dare\/todos\/\$\{encodeURIComponent\(todo\.id\)\}`/);
  assert.match(features,/大冒险待办/);
  assert.match(features,/new EventSource\('\/api\/games\/truth-dare\/stream'\)/);
  assert.match(features,/truthDareEventSource\.onmessage=/);
  assert.match(features,/truthDareEventSource\.onopen=/);
  assert.match(features,/truthDareEventSource\.close\(\)/);
  assert.doesNotMatch(features,/setInterval\(\(\)=>truthDareRefresh\(session\),3000\)/);
});

test('chat is bounded and nicknamed, with a home entry for shared adventure todos', () => {
  assert.match(css,/\.truth-dare-chat-list\{[^}]*height:250px;max-height:250px;overflow-y:auto/);
  assert.match(css,/\.truth-dare-chat-message\.is-mine\{align-self:flex-end/);
  assert.match(css,/\.truth-dare-chat-message\.is-theirs\{align-self:flex-start/);
  assert.match(css,/#modal:has\(\.truth-dare textarea:focus\)/);
  assert.match(features,/function truthDareNames\(\)/);
  assert.match(features,/scrollIntoView\(\{block:'nearest',behavior:'smooth'\}\)/);
  assert.match(html,/id="truth-dare-todos-open"/);
  assert.match(features,/function openTruthDareTodos\(\)/);
  assert.match(features,/completed:true/);
});

test('service worker cache version and resource URLs are refreshed', () => {
  // 只校验「有版本号且形如 vN」，不写死具体版本：写死过 v16，版本升到 v17 后这里就一直在偷偷失败。
  assert.match(sw, /CACHE_NAME='couple-home-v\d+'/);
  assert.match(sw, /style\.css\?v=/);
  assert.match(sw, /app\.js\?v=/);
  assert.match(sw, /features\.js\?v=/);
});

test('startup scripts stay deferred and do not preload over the blocking stylesheet', () => {
  // 3G 限速 A/B 实测：preload app.js 把它的 startTime 提前 30~90ms，但会与 83KB 的
  // 阻塞 style.css 抢带宽，FCP 反而慢 80~130ms。因此保持「一个阻塞 CSS + 全 defer 脚本」。
  assert.doesNotMatch(html, /rel="preload"/, '不要凭直觉加 preload，先用 Network 瀑布图量 FCP');
  const scripts = [...html.matchAll(/<script src="([^"]+)"([^>]*)>/g)];
  assert.ok(scripts.length >= 5, '主站脚本应保持 defer 加载，不要改成同步 script');
  for (const [, src, attrs] of scripts) {
    assert.match(attrs, /\bdefer\b/, `${src} 必须保持 defer`);
    assert.doesNotMatch(attrs, /\basync\b/, `${src} 不应改成 async，会打乱执行顺序`);
  }
});
