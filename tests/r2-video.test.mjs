import test from 'node:test';
import assert from 'node:assert/strict';
import { createR2VideoStore } from '../server/r2-video.mjs';

const config={accountId:'a'.repeat(32),accessKeyId:'A'.repeat(20),secretAccessKey:'s'.repeat(40),bucket:'couple-videos'};
const key=`videos/${'b'.repeat(64)}/00000000-0000-4000-8000-000000000001`;

test('R2 video adapter signs bounded direct uploads and verifies the completed object',async()=>{
  const sent=[],signed=[];
  const client={async send(command){sent.push(command);if(command.constructor.name==='HeadObjectCommand')return{ContentLength:1234,ContentType:'video/mp4',ETag:'"etag"'};return{}},destroy(){}};
  const signer=async(_client,command,options)=>{signed.push({command,options});return'https://signed.example/upload'};
  const store=createR2VideoStore({...config,client,signer});
  assert.equal(store.browserOrigin,`https://${config.accountId}.r2.cloudflarestorage.com`);
  assert.equal(await store.createUpload({key,contentType:'video/mp4',sizeBytes:1234}),'https://signed.example/upload');
  assert.equal(signed[0].command.constructor.name,'PutObjectCommand');
  assert.equal(signed[0].command.input.ContentLength,1234);
  assert.equal(signed[0].command.input.ContentType,'video/mp4');
  assert.equal(signed[0].options.expiresIn,600);
  assert.deepEqual(await store.complete({key,contentType:'video/mp4',sizeBytes:1234}),{etag:'etag'});
  assert.equal(await store.createDownload({key}),'https://signed.example/upload');
  await store.delete(key);
  assert.deepEqual(sent.map(command=>command.constructor.name),['HeadObjectCommand','DeleteObjectCommand']);
});

test('R2 video adapter rejects unsafe keys, types, sizes and mismatched objects',async()=>{
  const client={async send(){return{ContentLength:2,ContentType:'video/webm'}},destroy(){}};
  const store=createR2VideoStore({...config,client,signer:async()=>''});
  await assert.rejects(store.createUpload({key:'videos/../secret',contentType:'video/mp4',sizeBytes:1}),/存储键/);
  await assert.rejects(store.createUpload({key,contentType:'text/html',sizeBytes:1}),/MP4/);
  await assert.rejects(store.createUpload({key,contentType:'video/mp4',sizeBytes:501*1024*1024}),/500 MB/);
  await assert.rejects(store.complete({key,contentType:'video/mp4',sizeBytes:2}),/不一致/);
});
