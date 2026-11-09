import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication, travelContentSecurityPolicy } from '../dist-supabase/application.mjs';

const text=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('travel footprint subsite has its own explicitly scoped PWA',async()=>{
  const [page,worker,manifest,home,features,globalCss]=await Promise.all([
    text('public/travel/index.html'),text('public/travel/sw.js'),text('public/travel/manifest.json'),text('app/home.html'),text('public/features.js'),text('public/style.css'),
  ]);
  assert.match(page,/serviceWorker\.register\('\.\/sw\.js', \{ scope: '\.\/' \}\)/);
  assert.match(page,/href="\.\/vendor\/leaflet\.css"/);assert.match(page,/src="\.\/vendor\/leaflet\.js"/);assert.doesNotMatch(page,/jsdelivr/);
  assert.match(page,/href="\.\/vendor\/MarkerCluster\.css"/);assert.match(page,/href="\.\/vendor\/MarkerCluster\.Default\.css"/);
  assert.match(page,/src="\.\/vendor\/leaflet\.markercluster\.js"/);
  assert.match(page,/L\.markerClusterGroup\(\{[\s\S]*maxClusterRadius: 60[\s\S]*iconCreateFunction\(cluster\)/);
  assert.match(page,/cluster\.getAllChildMarkers\(\)\.reduce/);assert.match(page,/homePhotoLayer\.addLayer\(marker\)/);
  assert.match(page,/homePhotoLayer\.clearLayers\(\)/);assert.match(page,/className: 'home-photo-cluster'/);
  assert.match(page,/homePhotoCount: group\.photos\.length/);
  assert.match(page,/fetch\('\/api\/home', \{[\s\S]*credentials: 'same-origin'/);
  assert.match(page,/photo\.latitude/);assert.match(page,/photo\.longitude/);assert.match(page,/wgs2gcj\(group\.lat, group\.lng\)/);
  assert.match(page,/\/api\/photos\/' \+ encodeURIComponent\(photo\.id\)/);assert.match(page,/function groupHomePhotos/);
  assert.match(page,/homePhotosButton\.addEventListener\('click'/);assert.match(page,/loadHomePhotoMarkers\(\);/);
  assert.match(page,/<a id="homeBtn" href="\/"[^>]*>🏠 返回小屋<\/a>/);
  // moderate 依赖真实链接：原来的 <button> + location.href 无法被悬停意图触发。
  assert.match(page,/<script type="speculationrules">[\s\S]*"prerender"[\s\S]*"urls": \["\/"\][\s\S]*"eagerness": "moderate"[\s\S]*<\/script>/);
  assert.doesNotMatch(page,/location\.href = '\/'/);
  // 跨文档过渡要求两端文档都 opt-in：副站是内联 <style>，主站是 style.css。
  assert.match(page,/@view-transition\{navigation:auto\}/);
  assert.match(globalCss,/@view-transition\{navigation:auto\}/);
  assert.match(globalCss,/prefers-reduced-motion:reduce\)\{::view-transition-group\(\*\)/);
  assert.match(page,/#topbar > \* \{ flex:0 0 auto; \}/);
  assert.match(page,/@media \(max-width:768px\) \{[\s\S]*#topbar \{[\s\S]*overflow-x:auto;[\s\S]*white-space:nowrap;[\s\S]*touch-action:pan-x/);
  assert.match(page,/#topbar \{[^}]*-ms-overflow-style: none; scrollbar-width: none;/);
  assert.match(page,/#topbar::\-webkit-scrollbar \{ display:none; \}/);
  // <button> 时 #topbar button 会覆盖边框/内边距；改 <a> 后必须显式写回，外观才等价。
  assert.match(page,/#homeBtn \{[^}]*text-decoration:none[^}]*padding:7px 11px;[^}]*border:0/);
  assert.match(page,/<input type="file" id="fpPhoto" accept="image\/\*" multiple>/);
  assert.match(page,/function footprintPhotos\(fp\) \{[\s\S]*Array\.isArray\(fp\.photos\)[\s\S]*fp\.photo/);
  assert.match(page,/files\.map\(async file => \{[\s\S]*downscale\(dataUrl, 800, 0\.8\)/);
  assert.match(page,/photos: photoData/);
  assert.match(page,/function makeMarker\(fp\) \{[\s\S]*footprintPhotos\(fp\)\.forEach/);
  assert.match(page,/button\.addEventListener\('click', \(\) => openFootprintPhoto\(fp, index\)\)/);
  assert.match(page,/footprints\.flatMap\(footprint => footprintPhotos\(footprint\)/);
  assert.match(page,/fetch\('\/api\/travel\/footprints', \{credentials:'same-origin',cache:'no-store'/);
  assert.match(page,/method:'POST',credentials:'same-origin'/);
  assert.match(page,/setInterval\(syncTravelFootprints, 30000\)/);
  assert.match(page,/synced:\s*true/);
  assert.match(page,/fetch\('\/api\/travel\/footprints\/' \+ encodeURIComponent\(id\), \{[\s\S]*method:'DELETE'/);
  assert.match(page,/synced\) continue/);
  const [footprintsMigration,postgresMigration,r2Store]=await Promise.all([
    text('drizzle/0009_travel_footprints.sql'),text('deploy/render-supabase/migrations/0005_travel_footprints.sql'),text('server/r2-video.mjs'),
  ]);
  assert.match(footprintsMigration,/CREATE TABLE travel_footprints/);
  assert.match(postgresMigration,/CREATE TABLE public\.travel_footprints/);
  assert.match(r2Store,/putTravelPhoto/);assert.match(r2Store,/getTravelPhoto/);assert.match(r2Store,/deleteTravelPhoto/);
  assert.match(worker,/CACHE_PREFIX = 'couple-home-travel-'/);
  assert.match(worker,/CACHE = CACHE_PREFIX \+ 'v5'/);
  assert.match(worker,/url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker,/k\.startsWith\(CACHE_PREFIX\) && k !== CACHE/);
  assert.match(worker,/\.\/vendor\/leaflet\.js/);assert.match(worker,/\.\/vendor\/leaflet\.css/);assert.match(worker,/\.\/vendor\/leaflet\.markercluster\.js/);
  assert.match(worker,/\.\/vendor\/MarkerCluster\.css/);assert.match(worker,/\.\/vendor\/MarkerCluster\.Default\.css/);assert.match(worker,/origin !== self\.location\.origin/);
  assert.deepEqual(JSON.parse(manifest).scope,'/travel/');
  assert.match(home,/href="\/travel\/"/);assert.match(features,/location\.assign\('\/travel\/'\)/);
  assert.match(features,/travel:'🗺 旅行足迹'/);assert.match(features,/data-dock-page="travel"/);assert.match(features,/link\.href='\/travel\/'/);
});

test('Render build serves the travel app and its PWA files outside the login boundary',async()=>{
  const root=fileURLToPath(new URL('../dist-supabase/',import.meta.url)),dataDir=await mkdtemp(resolve(tmpdir(),'couple-travel-public-')),
    origin='http://127.0.0.1:32125',app=createApplication({root,dataDir,origin});
  try{
    for(const [path,type] of [['/travel/','text/html'],['/travel/sw.js','application/javascript'],['/travel/vendor/leaflet.js','application/javascript'],['/travel/vendor/leaflet.css','text/css'],['/travel/vendor/leaflet.markercluster.js','application/javascript'],['/travel/vendor/MarkerCluster.css','text/css'],['/travel/vendor/MarkerCluster.Default.css','text/css'],['/travel/vendor/leaflet.markercluster.LICENSE','application/octet-stream'],['/travel/manifest.json','application/manifest+json'],['/travel/icon-192.png','image/png']]){
      const response=await app.dispatch(new Request(origin+path));assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),new RegExp('^'+type.replace('+','\\+')));assert.ok((await response.arrayBuffer()).byteLength>0,path);
    }
    assert.equal((await app.dispatch(new Request(origin+'/travel/vendor/leaflet.js.map'))).status,404);
    assert.match(travelContentSecurityPolicy(),/script-src 'self' 'unsafe-inline'/);assert.match(travelContentSecurityPolicy(),/img-src 'self'/);assert.match(travelContentSecurityPolicy(),/connect-src 'self'/);assert.match(travelContentSecurityPolicy(),/https:\/\/\*\.is\.autonavi\.com/);assert.match(travelContentSecurityPolicy(),/https:\/\/nominatim\.openstreetmap\.org/);assert.doesNotMatch(travelContentSecurityPolicy(),/jsdelivr/);
  }finally{await app.close();await rm(dataDir,{recursive:true,force:true})}
});
