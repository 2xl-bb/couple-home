import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createApplication} from '../dist-node/application.mjs';

test('authenticated members share travel footprints and their private R2 photos', async t => {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'couple-travel-footprints-'));
  const objects = new Map();
  const videoStore = {
    async putTravelPhoto(key, bytes) { objects.set(key, Buffer.from(bytes)); },
    async getTravelPhoto(key) { const body = objects.get(key); return body ? {body:Buffer.from(body)} : null; },
    async deleteTravelPhoto(key) { objects.delete(key); },
    async close() {},
  };
  const origin = 'http://127.0.0.1:32128';
  const app = createApplication({root:resolve('dist-node'),dataDir,origin,videoStore});
  t.after(async () => { await app.close(); await rm(dataDir,{recursive:true,force:true}); });
  const call = (path, {method='GET',cookie='',body}={}) => app.dispatch(new Request(origin+path,{
    method,
    headers:{
      ...(cookie?{Cookie:cookie}:{}),
      ...(!['GET','HEAD'].includes(method)?{Origin:origin,'Content-Type':'application/json'}:{}),
    },
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  }));
  const setup = await call('/api/setup',{method:'POST',body:{
    passwords:['第一位成员的-私密密码-2026','第二位成员的-私密密码-2026'],
    confirmations:['第一位成员的-私密密码-2026','第二位成员的-私密密码-2026'],
  }});
  assert.equal(setup.status,200,await setup.clone().text());
  const ownerCookie=setup.headers.get('set-cookie').split(';')[0];
  const partnerLogin=await call('/api/auth',{method:'POST',body:{slot:2,password:'第二位成员的-私密密码-2026'}});
  assert.equal(partnerLogin.status,200,await partnerLogin.clone().text());
  const partnerCookie=partnerLogin.headers.get('set-cookie').split(';')[0];

  assert.equal((await call('/api/travel/footprints')).status,401);
  const image=Buffer.from([255,216,255,217]);
  const saved=await call('/api/travel/footprints',{method:'POST',cookie:ownerCookie,body:{
    id:'fp-cloud-test',city:'杭州',name:'西湖散步',lat:30.25,lng:120.16,date:'2026-11-08',
    note:'一起看晚霞',color:'#e8823c',createdAt:Date.now(),
    photos:['data:image/jpeg;base64,'+image.toString('base64')],
  }});
  assert.equal(saved.status,201,await saved.clone().text());
  const result=await saved.json(),footprint=result.footprint;
  assert.equal(footprint.city,'杭州');
  assert.equal(footprint.name,'西湖散步');
  assert.equal(footprint.photos.length,1);
  assert.match(footprint.photos[0],/^\/api\/travel\/footprints\/fp-cloud-test\/photos\/[a-f0-9-]{36}$/);
  assert.equal(footprint.synced,true);
  assert.equal(objects.size,1);

  assert.equal((await call(footprint.photos[0])).status,401);
  const listing=await call('/api/travel/footprints',{cookie:partnerCookie});
  assert.equal(listing.status,200);
  assert.equal((await listing.json()).footprints[0].name,'西湖散步');
  const photo=await call(footprint.photos[0],{cookie:partnerCookie});
  assert.equal(photo.status,200);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()),image);

  const invalid=await call('/api/travel/footprints',{method:'POST',cookie:ownerCookie,body:{
    id:'fp-invalid',city:'',name:'坏坐标',lat:200,lng:0,date:'2026-11-08',photos:[],
  }});
  assert.equal(invalid.status,400);
  const removed=await call('/api/travel/footprints/fp-cloud-test',{method:'DELETE',cookie:partnerCookie});
  assert.equal(removed.status,200,await removed.clone().text());
  assert.equal(objects.size,0);
  assert.deepEqual((await (await call('/api/travel/footprints',{cookie:ownerCookie})).json()).footprints,[]);
  assert.equal((await call(footprint.photos[0],{cookie:ownerCookie})).status,404);
});
