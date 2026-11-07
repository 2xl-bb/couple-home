import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source=await readFile('public/app.js','utf8');
const timeline=source.slice(source.indexOf("let albumMonth="),source.indexOf('function viewPhoto'));
const stamp=(year,month,day)=>Date.UTC(year,month-1,day,12);

function fixture(photos){
  const output={},nodes=new Map();
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{dataset:{},setAttribute(name,value){this[name]=value},addEventListener(){}});return nodes.get(selector)};
  const context=vm.createContext({state:{photos,names:['一','二'],videos:[]},$:get,renderContent:(selector,html)=>output[selector]=html,
    esc:String,photoSource:id=>'/api/photos/'+id,Date,Map,Set,console,loadPagesPhotos(){}});
  vm.runInContext(timeline,context);
  return{context,output,get,render:()=>context.renderAlbum()};
}

test('default timeline is newest-first and only materializes the first month',()=>{
  const f=fixture([
    {id:'jan',caption:'January',created_at:stamp(2026,1,1)},
    {id:'nov',caption:'November',created_at:stamp(2026,11,1)},
    {id:'old',caption:'Old',created_at:stamp(2025,12,1)},
  ]);
  f.render();const html=f.output['#photo-list'];
  assert.ok(html.indexOf('2026年')<html.indexOf('2025年'));
  assert.ok(html.indexOf('11月')<html.indexOf('1月'));
  assert.match(html,/November/);
  assert.doesNotMatch(html,/January/);
  assert.doesNotMatch(html,/>Old</);
});

test('sort toggle reverses years, months and photo order',()=>{
  const f=fixture([
    {id:'newer',caption:'Newer',created_at:stamp(2026,2,2)},
    {id:'new',caption:'New',created_at:stamp(2026,2,1)},
    {id:'old',caption:'Old',created_at:stamp(2025,12,1)},
  ]);
  f.render();f.get('#album-sort').onclick();const html=f.output['#photo-list'];
  assert.ok(html.indexOf('2025年')<html.indexOf('2026年'));
  assert.match(html,/Old/);
  assert.equal(f.get('#album-sort').textContent,'↑');
});

test('taken_at overrides a recent upload date for historical grouping',()=>{
  const f=fixture([{id:'scan',caption:'Old memory',created_at:stamp(2026,11,1),taken_at:stamp(2012,3,4)}]);
  f.render();const html=f.output['#photo-list'];
  assert.match(html,/2012年/);assert.match(html,/3月/);assert.doesNotMatch(html,/2026年/);
});

test('a 250-photo month creates 24 cards until explicitly expanded',()=>{
  const photos=Array.from({length:250},(_,index)=>({id:`p-${index}`,caption:`Photo ${index}`,created_at:stamp(2026,11,30)-index}));
  const f=fixture(photos);f.render();
  assert.equal((f.output['#photo-list'].match(/class="photo-item has-photo"/g)||[]).length,24);
  assert.match(f.output['#photo-list'],/data-more-album-month="2026-11"/);
  vm.runInContext("albumMonthLimits.set('2026-11',48);renderAlbum()",f.context);
  assert.equal((f.output['#photo-list'].match(/class="photo-item has-photo"/g)||[]).length,48);
});
