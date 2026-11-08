import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication, travelContentSecurityPolicy } from '../dist-supabase/application.mjs';

const text=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('travel footprint subsite has its own explicitly scoped PWA',async()=>{
  const [page,worker,manifest,home,features]=await Promise.all([
    text('public/travel/index.html'),text('public/travel/sw.js'),text('public/travel/manifest.json'),text('app/home.html'),text('public/features.js'),
  ]);
  assert.match(page,/serviceWorker\.register\('\.\/sw\.js', \{ scope: '\.\/' \}\)/);
  assert.match(page,/href="\.\/vendor\/leaflet\.css"/);assert.match(page,/src="\.\/vendor\/leaflet\.js"/);assert.doesNotMatch(page,/jsdelivr/);
  assert.match(worker,/CACHE_PREFIX = 'couple-home-travel-'/);
  assert.match(worker,/CACHE = CACHE_PREFIX \+ 'v2'/);
  assert.match(worker,/k\.startsWith\(CACHE_PREFIX\) && k !== CACHE/);
  assert.match(worker,/\.\/vendor\/leaflet\.js/);assert.match(worker,/\.\/vendor\/leaflet\.css/);assert.match(worker,/origin !== self\.location\.origin/);
  assert.deepEqual(JSON.parse(manifest).scope,'/travel/');
  assert.match(home,/href="\/travel\/"/);assert.match(features,/location\.assign\('\/travel\/'\)/);
  assert.match(features,/travel:'🗺 旅行足迹'/);assert.match(features,/data-dock-page="travel"/);assert.match(features,/link\.href='\/travel\/'/);
});

test('Render build serves the travel app and its PWA files outside the login boundary',async()=>{
  const root=fileURLToPath(new URL('../dist-supabase/',import.meta.url)),dataDir=await mkdtemp(resolve(tmpdir(),'couple-travel-public-')),
    origin='http://127.0.0.1:32125',app=createApplication({root,dataDir,origin});
  try{
    for(const [path,type] of [['/travel/','text/html'],['/travel/sw.js','application/javascript'],['/travel/vendor/leaflet.js','application/javascript'],['/travel/vendor/leaflet.css','text/css'],['/travel/manifest.json','application/manifest+json'],['/travel/icon-192.png','image/png']]){
      const response=await app.dispatch(new Request(origin+path));assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),new RegExp('^'+type.replace('+','\\+')));assert.ok((await response.arrayBuffer()).byteLength>0,path);
    }
    assert.equal((await app.dispatch(new Request(origin+'/travel/vendor/leaflet.js.map'))).status,404);
    assert.match(travelContentSecurityPolicy(),/script-src 'self' 'unsafe-inline'/);assert.match(travelContentSecurityPolicy(),/https:\/\/\*\.is\.autonavi\.com/);assert.match(travelContentSecurityPolicy(),/https:\/\/nominatim\.openstreetmap\.org/);assert.doesNotMatch(travelContentSecurityPolicy(),/jsdelivr/);
  }finally{await app.close();await rm(dataDir,{recursive:true,force:true})}
});
