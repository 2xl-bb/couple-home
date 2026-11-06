import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('PWA manifest and iOS metadata describe an installable standalone app',async()=>{
  const manifest=JSON.parse(await text('public/manifest.json'));
  assert.equal(manifest.name,'Couple Home');
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');
  assert.equal(manifest.display,'standalone');
  assert.deepEqual(manifest.icons.map(icon=>[icon.src,icon.sizes,icon.type]),[
    ['/icon-192.png','192x192','image/png'],
    ['/icon-512.png','512x512','image/png'],
  ]);
  const html=await text('app/home.html');
  assert.match(html,/<link rel="manifest" href="\/manifest\.json">/);
  assert.match(html,/<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html,/<link rel="apple-touch-icon" href="\/icon-192\.png">/);
});

test('PWA icons are real PNG files with the declared dimensions',async()=>{
  for(const size of [192,512]){
    const image=await readFile(new URL(`../public/icon-${size}.png`,import.meta.url));
    assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(image.readUInt32BE(16),size);
    assert.equal(image.readUInt32BE(20),size);
  }
});

test('service worker registration and cache rules exclude private and streaming traffic',async()=>{
  const app=await text('public/app.js'),worker=await text('public/sw.js');
  assert.match(app,/serviceWorker\.register\('\/sw\.js'/);
  assert.match(worker,/url\.origin!==self\.location\.origin/);
  assert.match(worker,/url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker,/request\.headers\.has\('authorization'\)/);
  assert.match(worker,/request\.headers\.has\('range'\)/);
  assert.match(worker,/request\.destination==='video'/);
  assert.match(worker,/request\.destination==='audio'/);
  assert.doesNotMatch(worker,/supabase/i);
});

test('Render build contains every PWA asset and linked metadata',async()=>{
  const html=await text('dist-supabase/public/index.html');
  assert.match(html,/href="\/manifest\.json"/);
  for(const name of ['manifest.json','sw.js','icon-192.png','icon-512.png']){
    const file=await readFile(new URL('../dist-supabase/public/'+name,import.meta.url));
    assert.ok(file.length>0,name);
  }
});
