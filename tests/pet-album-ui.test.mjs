import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {petNow} from '../lib/home-domain.mjs';

const source=await readFile('public/app.js','utf8');
const viewContext=vm.createContext({});
vm.runInContext(await readFile('public/pet-view.js','utf8'),viewContext);
const view=viewContext.LittleDaysPetView;
const now=Date.UTC(2026,9,26),pet={name:'团团',kind:'cat',color:'cream',xp:0,fullness:70,happiness:65,energy:30,updatedAt:now,sleepingUntil:now+300000,careLog:[]};

test('startup pet values remain finite before the first server response',()=>{
 const context=vm.createContext({Date});
 vm.runInContext(source.slice(source.indexOf('const empty='),source.indexOf('let state='))+'globalThis.initial=empty();',context);
 const projected=view.project(context.initial.pet);
 for(const key of ['fullness','happiness','energy'])assert.equal(Number.isFinite(projected[key]),true,key+' must not render NaN');
});

test('growth thresholds change the actual anatomy for both species and escape names',()=>{
 assert.deepEqual([0,199,200,499,500].map(view.stage),['baby','baby','young','young','grown']);
 for(const kind of ['cat','bunny']){
  const arts=[0,200,500].map(xp=>view.art({...pet,kind,xp,name:'<img onerror="boom">'}));
  assert.equal(new Set(arts).size,3);
  for(const [i,art]of arts.entries()){assert.ok(art.includes(`data-growth="${['baby','young','grown'][i]}"`));assert.ok(art.includes('&lt;img'));assert.ok(!art.includes('<img'));}
  // Body height differs: these are distinct silhouettes rather than SVG scaling.
  for(const [i,height]of [30,39,48].entries())assert.match(arts[i],new RegExp(`ry="${height}"`));
 }
});

test('custom stages switch visuals at configured thresholds and escape unsafe content',()=>{
 const stages=[{name:'起步',start:0,kind:'cat',shape:'baby',color:'#123456',accessory:'bow'},{name:'未来',start:50,kind:'bunny',shape:'grown',color:'#654321',accessory:'star'}];
 assert.equal(view.currentStage({...pet,stages,xp:49}).current.name,'起步');assert.equal(view.currentStage({...pet,stages,xp:50}).current.name,'未来');
 const first=view.art({...pet,stages,xp:49}),second=view.art({...pet,stages,xp:50});assert.match(first,/#123456/);assert.match(second,/#654321/);assert.match(second,/★/);assert.notEqual(first,second);
 const unsafe=view.art({...pet,stages:[{...stages[0],color:'" onload="x'}],xp:0});assert.ok(!unsafe.includes('onload='));
});

test('live bars use the same elapsed-time and sleep recovery formula as the server',()=>{
 for(const delta of [0,1000,120000,300000,301000,3600000,86400000]){
  const projected=view.project(pet,now+delta),server=petNow(pet,now+delta);
  for(const key of ['fullness','happiness','energy'])assert.equal(projected[key],server[key],key+' at '+delta);
 }
 assert.equal(pet.energy,30);
});

test('sleep overrides actions, actions expire, and low states choose matching poses',()=>{
 assert.equal(view.motion({...pet,careLog:[{action:'pet',at:now}]},now),'sleep');
 for(const action of ['feed','play','pet','duet']){
  const p={...pet,sleepingUntil:0,energy:80,careLog:[{action,at:now}]};
  assert.equal(view.motion(p,now+2000),action);assert.equal(view.motion(p,now+5500),'idle');
 }
 assert.equal(view.motion({...pet,sleepingUntil:0},now),'tired');
 assert.equal(view.motion({...pet,sleepingUntil:0,energy:80,fullness:25},now),'hungry');
 assert.equal(view.motion({...pet,sleepingUntil:0,energy:80,happiness:25},now),'lonely');
});

test('album renders a minimal grouped timeline and shared caption history',()=>{
 const outputs={},nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{setAttribute(name,value){this[name]=value}});return nodes.get(s)};
 const context=vm.createContext({state:{photos:[],names:['小月','小林']},$:get,renderContent:(s,html)=>outputs[s]=html,esc:String,photoSource:id=>'/api/photos/'+id,Date});
 vm.runInContext(source.slice(source.indexOf("let albumMonth="),source.indexOf('function viewPhoto')),context);
 context.renderAlbum();assert.match(outputs['#photo-list'],/class="album-empty"/);assert.match(outputs['#photo-list'],/data-upload/);
 context.state.photos=Array.from({length:30},(_,i)=>({id:'p'+i,created_at:now-i,caption:'回忆'}));context.renderAlbum();assert.match(outputs['#photo-list'],/2026年/);assert.match(outputs['#photo-list'],/10月/);assert.equal((outputs['#photo-list'].match(/class="photo-item has-photo"/g)||[]).length,24);assert.match(outputs['#photo-list'],/data-more-album-month/);
 context.state.photos=[{id:'shared',created_at:now,caption:'最初的文字',captions:[{id:'original',text:'最初的文字',createdAt:now,authorSlot:1,original:true},{id:'later-note',text:'后来补充的文字',createdAt:now+1000,authorSlot:2,original:false}]}];context.renderAlbum();assert.match(outputs['#photo-list'],/原配文 · 小月/);assert.match(outputs['#photo-list'],/补充 · 小林/);assert.match(outputs['#photo-list'],/后来补充的文字/);assert.match(outputs['#photo-list'],/data-add-photo-caption="shared"/);assert.match(outputs['#photo-list'],/class="photo-delete"/);
 context.LittleDaysAlbum={filter:()=>[],renderTools(){}};context.renderAlbum();assert.equal(get('#album-count')['aria-label'],'没有符合当前搜索的照片');
});

function uploadFixture(){
 let submit,uploaded=[],uploadDetails=[],fail='',refreshes=0,closed=0;
 const nodes={'#modal':{dataset:{},addEventListener(){}},'#upload-progress':{},'#upload-status':{},'#active-form button[type="submit"]':{},'#active-form input[name="photo"]':{files:[]},'#photo-preview':{}};
 const context=vm.createContext({$:selector=>nodes[selector],needReady:()=>true,modal(){},field:(...args)=>args.join(' '),form:(html,fn)=>{assert.match(html,/multiple/);submit=fn},esc:String,extractPhotoMeta:async()=>({takenAt:Date.now(),lat:null,lng:null}),compressPhoto:async file=>file,uploadPhoto:async(...args)=>{const file=args[0];if(file.name===fail){fail='';throw Error('网络中断')}uploaded.push(file.name);uploadDetails.push(args.slice(6,9))},refreshNow:async()=>{refreshes++},close:()=>{closed++},toast(){},URL,albumLimit:12,albumMonth:'2026-01'});
 vm.runInContext(source.slice(source.indexOf('function addPhoto()'),source.indexOf("$('#add-photo').onclick=addPhoto;")),context);
 return {open:()=>context.addPhoto(),send:(files,manualLocation='')=>{nodes['#active-form input[name="photo"]'].files=files;return submit({get:name=>name==='manual_location'?manualLocation:''})},set fail(v){fail=v},get uploaded(){return uploaded},get uploadDetails(){return uploadDetails},get refreshes(){return refreshes},get closed(){return closed}};
}

test('multi-photo upload can reopen and add again; partial failure retains already saved work',async()=>{
 const f=uploadFixture(),photo=name=>({name,size:1024});
 f.open();await f.send([photo('a'),photo('b')]);assert.equal(f.closed,1);
 f.open();await f.send([photo('c')]);assert.equal(f.closed,2);assert.deepEqual(f.uploaded,['a','b','c']);
 f.open();f.fail='e';await assert.rejects(()=>f.send([photo('d'),photo('e')]),/网络中断/);assert.ok(f.uploaded.includes('d'));assert.equal(f.closed,2);assert.equal(f.refreshes,3);
 await f.send([photo('d'),photo('e')]);assert.equal(f.closed,3); // Server merge key makes the retried d idempotent.
 f.open();await assert.rejects(()=>f.send(Array.from({length:21},(_,i)=>photo(String(i)))),/20 张/);
});

test('manual city location is passed to the same upload flow when EXIF GPS is missing',async()=>{
 const f=uploadFixture(),photo={name:'screenshot.jpg',size:1024};
 f.open();await f.send([photo],'shanghai');
 assert.deepEqual(f.uploadDetails[0],[31.2304,121.4737,'上海']);
});

test('all selected decorations render in the main room and cancel restores saved room',async()=>{
 const source=await readFile('public/features.js','utf8'),outputs={},main={dataset:{}},small={dataset:{},innerHTML:''};let closeListener,handler;
 const saved={theme:'cream',items:['cushion']},nodes={'#decorate-room':{},'.pet-scene':main,'#pet-room-scene':small,'#decor-preview':null,'#active-form':{addEventListener:(event,fn)=>handler=fn},'#modal':{addEventListener:(event,fn)=>closeListener=fn},'#active-form button[type="submit"]':{}};
 const roomContext=vm.createContext({state:{pet:{...pet,room:saved}},$:s=>nodes[s],ROOM_DECOR:['cushion','plant','rug','lamp','photo','stars'].map(id=>[id,id,'',0]),renderContent:(s,html)=>{outputs[s]=html;if(s==='#pet-room-scene')small.innerHTML=html},petArt:()=>'<svg/>',renderPet(){},needReady:()=>true,modal(){},form(){},FormData:class{get(){return 'sage'}getAll(){return ['plant','lamp']}}});
 vm.runInContext(source.slice(source.indexOf('let roomPreview='),source.indexOf('function monthRecords')),roomContext);
 roomContext.renderPetRoom({theme:'rose',items:['cushion','plant','rug','lamp','photo','stars']});assert.equal(main.dataset.theme,'rose');for(const id of ['cushion','plant','rug','lamp','photo','stars'])assert.match(outputs['#main-room-decor'],new RegExp('decor-'+id));
 nodes['#decorate-room'].onclick();handler();assert.equal(main.dataset.theme,'sage');assert.ok(!outputs['#main-room-decor'].includes('decor-cushion'));closeListener();assert.equal(main.dataset.theme,'cream');assert.match(outputs['#main-room-decor'],/decor-cushion/);
});
