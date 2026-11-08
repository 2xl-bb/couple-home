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

test('truth-or-dare draws a category and a safe text-only prompt', () => {
  const start = app.indexOf('const truths=');
  const end = app.indexOf('function openTruthDare()', start);
  const nodes = {
    '#truth-dare-kind': {textContent: ''},
    '#truth-dare-question': {textContent: ''},
    '#truth-dare-result': {hidden: true}
  };
  const draws = [0.1, 0.6, 0.9, 0.01];
  const context = vm.createContext({$: selector => nodes[selector], Math: {random: () => draws.shift(), floor: Math.floor}});
  vm.runInContext(app.slice(start, end), context);
  context.drawTruthDare();
  assert.equal(nodes['#truth-dare-kind'].textContent, '真心话');
  assert.equal(nodes['#truth-dare-question'].textContent, '最近一次觉得“有你真好”是什么时候？');
  assert.equal(nodes['#truth-dare-result'].hidden, false);
  context.drawTruthDare();
  assert.equal(nodes['#truth-dare-kind'].textContent, '大冒险');
  assert.equal(nodes['#truth-dare-question'].textContent, '为对方选一首歌，哼出最喜欢的一句。');
});

test('service worker cache version and resource URLs are refreshed', () => {
  assert.match(sw, /couple-home-v9/);
  assert.match(sw, /style\.css\?v=20261108-truth-dare/);
  assert.match(sw, /app\.js\?v=20261108-truth-dare/);
});
