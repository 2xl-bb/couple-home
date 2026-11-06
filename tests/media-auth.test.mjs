import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy, createApplication } from '../dist-supabase/application.mjs';

const root=fileURLToPath(new URL('../dist-supabase/',import.meta.url));
const origin='http://127.0.0.1:32123';

test('browser policy permits only the configured private R2 bucket for video transfer',()=>{
  const r2='https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com';
  const policy=contentSecurityPolicy(r2);
  assert.match(policy,new RegExp(`connect-src[^;]+${r2.replaceAll('.','\\.')}`));
  assert.match(policy,new RegExp(`media-src[^;]+${r2.replaceAll('.','\\.')}`));
  assert.doesNotMatch(contentSecurityPolicy('https://evil.example'),/evil\.example/);
});

test('authenticated couple shares video completion, listing, download and deletion',async()=>{
  const dataDir=await mkdtemp(resolve(tmpdir(),'couple-media-auth-')),objects=new Map();
  const videoStore={
    async createUpload(input){objects.set(input.key,{...input,uploaded:false});return'https://r2.example/upload'},
    async complete(input){const object=objects.get(input.key);if(!object)throw Error('missing');object.uploaded=true;return{}},
    async createDownload({key}){assert.equal(objects.get(key)?.uploaded,true);return'https://r2.example/private'},
    async delete(key){objects.delete(key)},async close(){},
  };
  const app=createApplication({root,dataDir,origin,videoStore});
  const call=(path,{method='GET',cookie='',body}={})=>app.dispatch(new Request(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(!['GET','HEAD'].includes(method)?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  try{
    const passwords=['Owner66','Partner66'];
    const setup=await call('/api/setup',{method:'POST',body:{passwords,confirmations:passwords}});assert.equal(setup.status,200);
    const owner=setup.headers.getSetCookie()[0].split(';')[0];
    const login=await call('/api/auth',{method:'POST',body:{slot:2,password:passwords[1]}});assert.equal(login.status,200);
    const partner=login.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await call('/api/videos/presign',{method:'POST',body:{contentType:'video/mp4',sizeBytes:10}})).status,401);
    const ticket=await call('/api/videos/presign',{method:'POST',cookie:owner,body:{contentType:'video/mp4',sizeBytes:10,caption:'共同回忆'}});assert.equal(ticket.status,201,await ticket.clone().text());
    const {id}=await ticket.json();
    assert.equal((await call(`/api/videos/${id}/complete`,{method:'POST',cookie:partner})).status,200);
    assert.equal((await call(`/api/videos/${id}/url`,{cookie:partner})).status,200);
    assert.equal((await call(`/api/videos/${id}/url`)).status,401);
    const partnerHome=await(await call('/api/home',{cookie:partner})).json();assert.deepEqual(partnerHome.state.videos.map(v=>v.id),[id]);
    const ownerHome=await(await call('/api/home',{cookie:owner})).json();assert.deepEqual(ownerHome.state.videos.map(v=>v.id),[id]);
    assert.equal((await call(`/api/videos/${id}`,{method:'DELETE',cookie:partner})).status,200);
    assert.equal((await call(`/api/videos/${id}/url`,{cookie:owner})).status,404);
  }finally{await app.close();await rm(dataDir,{recursive:true,force:true})}
});
