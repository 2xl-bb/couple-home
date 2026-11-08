import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const [app,html,css,sw]=await Promise.all([
  readFile('public/app.js','utf8'),
  readFile('app/home.html','utf8'),
  readFile('public/style.css','utf8'),
  readFile('public/sw.js','utf8'),
]);

test('photo viewer displays a location action and persists a map selection',()=>{
  assert.match(app,/未标记位置（点击添加）/);
  assert.match(app,/photo\.location_name/);
  assert.match(app,/\/api\/photos\/'\+encodeURIComponent\(id\)\+'\/location/);
  assert.match(app,/method:'PATCH'/);
  assert.match(app,/\/travel\/vendor\/leaflet\.js/);
  assert.match(app,/https:\/\/\{s\}\.tile\.openstreetmap\.org/);
  assert.match(app,/nominatim\.openstreetmap\.org\/reverse/);
  assert.match(app,/draggable:true/);
  assert.match(css,/#photo-location-map\{height:360px/);
  assert.match(html,/app\.js\?v=20261108-photo-location/);
  assert.match(sw,/couple-home-v15/);
  assert.match(sw,/style\.css\?v=20261108-truth-chat/);
});

test('photos with null GPS are treated as unmarked rather than coordinates at zero',()=>{
  const start=app.indexOf('function photoHasLocation('),end=app.indexOf('\nfunction viewPhoto(',start);
  const context=vm.createContext({Number});
  vm.runInContext(app.slice(start,end),context);
  assert.equal(context.photoHasLocation({latitude:null,longitude:null}),false);
  assert.equal(context.photoHasLocation({latitude:0,longitude:0}),true);
  assert.equal(context.photoHasLocation({latitude:32.06,longitude:118.79}),true);
});
