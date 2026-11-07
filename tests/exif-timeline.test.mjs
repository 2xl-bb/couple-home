import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import exifr from 'exifr';
import vm from 'node:vm';

function historicalJpeg(){
  const tiff=Buffer.alloc(64);tiff.write('II',0);tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x8769,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt32LE(26,18);tiff.writeUInt32LE(0,22);
  tiff.writeUInt16LE(1,26);tiff.writeUInt16LE(0x9003,28);tiff.writeUInt16LE(2,30);tiff.writeUInt32LE(20,32);tiff.writeUInt32LE(44,36);tiff.writeUInt32LE(0,40);
  Buffer.from('2012:03:04 05:06:07\0').copy(tiff,44);
  const payload=Buffer.concat([Buffer.from([69,120,105,102,0,0]),tiff]);
  return Buffer.concat([Buffer.from([255,216,255,225,(payload.length+2)>>8,(payload.length+2)&255]),payload,Buffer.from([255,217])]);
}

test('exifr reads an old DateTimeOriginal fixture',async()=>{
  const metadata=await exifr.parse(new Uint8Array(historicalJpeg()),['DateTimeOriginal']);
  assert.ok(metadata.DateTimeOriginal instanceof Date);
  assert.equal(metadata.DateTimeOriginal.getFullYear(),2012);
  assert.equal(metadata.DateTimeOriginal.getMonth(),2);
});

test('upload flow extracts EXIF before canvas compression',async()=>{
  const source=await readFile('public/app.js','utf8'),loop=source.slice(source.indexOf('function addPhoto()'),source.indexOf("$('#add-photo').onclick=addPhoto;"));
  assert.ok(loop.indexOf('extractPhotoTakenAt(file)')>=0);
  assert.ok(loop.indexOf('extractPhotoTakenAt(file)')<loop.indexOf('compressPhoto(file)'));
  assert.match(source,/exifr\.parse\(file,\['DateTimeOriginal'\]\)/);
});

test('missing or broken EXIF data quietly falls back to the upload time',async()=>{
  const source=await readFile('public/app.js','utf8'),code=source.slice(source.indexOf('async function extractPhotoTakenAt'),source.indexOf('async function uploadPhoto')),
    logs=[],context=vm.createContext({Date,console:{log:(...args)=>logs.push(args)},globalThis:{exifr:{parse:async()=>{throw new TypeError('undefined is not iterable')}}}});
  vm.runInContext(code,context);const now=Date.UTC(2026,10,7),takenAt=await context.extractPhotoTakenAt({type:'image/jpeg'},now);
  assert.equal(takenAt,now);assert.deepEqual(logs,[['提取到的 EXIF 时间:',now]]);
});
