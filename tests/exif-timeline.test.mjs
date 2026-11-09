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

function gpsJpeg(latitudeRef='N',longitudeRef='E'){
  const tiff=Buffer.alloc(128);tiff.write('II',0);tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x8825,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt32LE(26,18);tiff.writeUInt32LE(0,22);
  tiff.writeUInt16LE(4,26);
  tiff.writeUInt16LE(1,28);tiff.writeUInt16LE(2,30);tiff.writeUInt32LE(2,32);tiff[36]=latitudeRef.charCodeAt(0);
  tiff.writeUInt16LE(2,40);tiff.writeUInt16LE(5,42);tiff.writeUInt32LE(3,44);tiff.writeUInt32LE(80,48);
  tiff.writeUInt16LE(3,52);tiff.writeUInt16LE(2,54);tiff.writeUInt32LE(2,56);tiff[60]=longitudeRef.charCodeAt(0);
  tiff.writeUInt16LE(4,64);tiff.writeUInt16LE(5,66);tiff.writeUInt32LE(3,68);tiff.writeUInt32LE(104,72);tiff.writeUInt32LE(0,76);
  [[31,1],[13,1],[4944,100],[121,1],[28,1],[2532,100]].forEach(([n,d],index)=>{const offset=80+Math.floor(index/3)*24+(index%3)*8;tiff.writeUInt32LE(n,offset);tiff.writeUInt32LE(d,offset+4)});
  const payload=Buffer.concat([Buffer.from([69,120,105,102,0,0]),tiff]);
  return Buffer.concat([Buffer.from([255,216,255,225,(payload.length+2)>>8,(payload.length+2)&255]),payload,Buffer.from([255,217])]);
}

test('exifr reads an old DateTimeOriginal fixture',async()=>{
  const metadata=await exifr.parse(new Uint8Array(historicalJpeg()),['DateTimeOriginal']);
  assert.ok(metadata.DateTimeOriginal instanceof Date);
  assert.equal(metadata.DateTimeOriginal.getFullYear(),2012);
  assert.equal(metadata.DateTimeOriginal.getMonth(),2);
});

test('album.js compressImage downsizes images to 1920px and encodes JPEG at 0.8',async()=>{
  const source=await readFile('public/album.js','utf8'),code=source.slice(source.indexOf('  const COMPRESS_MAX_EDGE'),source.indexOf('  function filter(photos, month)'));
  let encoded,revoked=false;
  class Image{constructor(){this.width=3200;this.height=2000;this.naturalWidth=3200;this.naturalHeight=2000}async decode(){}set src(value){this.source=value}}
  const canvas={getContext:()=>({fillRect(){},drawImage(){}}),toBlob(callback,type,quality){encoded={type,quality,width:this.width,height:this.height};callback(new Blob(['jpeg'],{type}))}};
  const context=vm.createContext({Image,URL:{createObjectURL:()=>'blob:photo',revokeObjectURL:()=>{revoked=true}},document:{createElement:()=>canvas},Promise,Error});
  vm.runInContext(code,context);
  const output=await context.compressImage({type:'image/png',size:1024});
  assert.equal(encoded.type,'image/jpeg');assert.equal(encoded.quality,.8);assert.equal(encoded.width,1920);assert.equal(encoded.height,1200);
  assert.equal(output.type,'image/jpeg');assert.equal(revoked,true);
  assert.match(source,/root\.LittleDaysAlbum = \{[^}]*compressImage/);
});

test('compressPhoto delegates to the shared 1920px/0.8 canvas encoder',async()=>{
  const source=await readFile('public/app.js','utf8'),code=source.slice(source.indexOf('async function compressPhoto'),source.indexOf('async function extractPhotoMeta'));
  let called=null;
  const context=vm.createContext({Promise,Error,LittleDaysAlbum:{compressImage:async(file,options)=>{called={file,options};return new Blob(['jpeg'],{type:'image/jpeg'})}}});
  vm.runInContext(code,context);
  const file={type:'image/png',size:1024},output=await context.compressPhoto(file);
  assert.equal(called.file,file);assert.equal(called.options.maxEdge,1920);assert.equal(called.options.quality,.8);
  assert.equal(output.type,'image/jpeg');
  await assert.rejects(()=>context.compressPhoto({type:'image/png',size:21*1024*1024}),/20MB/);
});

test('exifr parses GPS coordinates when the GPS parser is enabled',async()=>{
  const metadata=await exifr.parse(new Uint8Array(gpsJpeg()),{gps:true,exif:true,tiff:true});
  assert.ok(Math.abs(metadata.latitude-31.2304)<1e-10);
  assert.ok(Math.abs(metadata.longitude-121.4737)<1e-10);
  const southern=await exifr.parse(new Uint8Array(gpsJpeg('S','W')),{gps:true,exif:true,tiff:true});
  assert.ok(Math.abs(southern.latitude+31.2304)<1e-10);
  assert.ok(Math.abs(southern.longitude+121.4737)<1e-10);
});

test('upload flow extracts EXIF before canvas compression',async()=>{
  const source=await readFile('public/app.js','utf8'),loop=source.slice(source.indexOf('function addPhoto()'),source.indexOf("$('#add-photo').onclick=addPhoto;"));
  assert.ok(loop.indexOf('extractPhotoMeta(file)')>=0);
  assert.ok(loop.indexOf('extractPhotoMeta(file)')<loop.indexOf('compressPhoto(file)'));
  assert.match(source,/exifr\.parse\(file,\s*\{\s*gps:\s*true,\s*exif:\s*true,\s*tiff:\s*true\s*\}\)/);
  assert.match(loop,/name="manual_location"/);
});

test('missing or broken EXIF data quietly falls back to the upload time',async()=>{
  const source=await readFile('public/app.js','utf8'),code=source.slice(source.indexOf('async function extractPhotoMeta'),source.indexOf('async function uploadPhoto')),
    logs=[],context=vm.createContext({Date,console:{log:(...args)=>logs.push(args),warn(){}},globalThis:{exifr:{parse:async()=>{throw new TypeError('undefined is not iterable')}}}});
  vm.runInContext(code,context);const now=Date.UTC(2026,10,7),metadata=await context.extractPhotoMeta({type:'image/jpeg'},now);
  assert.deepEqual({...metadata},{takenAt:now,lat:null,lng:null});assert.equal(logs[0][0],'完整EXIF:');assert.equal(logs[0][1],null);assert.equal(logs[1][0],'提取到的元数据:');assert.deepEqual({...logs[1][1]},{takenAt:now,lat:null,lng:null});
});

test('EXIF GPS parsing enables GPS tags and converts DMS fallback coordinates',async()=>{
  const source=await readFile('public/app.js','utf8'),code=source.slice(source.indexOf('async function extractPhotoMeta'),source.indexOf('async function uploadPhoto')),
    logs=[],calls=[],data={DateTimeOriginal:new Date('2026-01-02T03:04:05Z'),GPSLatitude:[31,13,49.44],GPSLatitudeRef:'N',GPSLongitude:[121,28,25.32],GPSLongitudeRef:'E'},
    context=vm.createContext({Date,console:{log:(...args)=>logs.push(args),warn(){}},globalThis:{exifr:{parse:async(...args)=>{calls.push(args);return data}}}});
  vm.runInContext(code,context);const result=await context.extractPhotoMeta({type:'image/jpeg'},Date.UTC(2026,10,7));
  assert.equal(calls.length,1);assert.deepEqual({...calls[0][1]},{gps:true,exif:true,tiff:true});
  assert.ok(Math.abs(result.lat-31.2304)<1e-10);assert.ok(Math.abs(result.lng-121.4737)<1e-10);assert.equal(logs[0][0],'完整EXIF:');assert.equal(logs[0][1],data);
});

test('extractPhotoMeta uses the requested options with exifr on an EXIF GPS image',async()=>{
  const source=await readFile('public/app.js','utf8'),code=source.slice(source.indexOf('async function extractPhotoMeta'),source.indexOf('async function uploadPhoto')),
    logs=[],context=vm.createContext({Date,console:{log:(...args)=>logs.push(args),warn(){}},globalThis:{exifr}});
  vm.runInContext(code,context);
  const image=new Uint8Array(gpsJpeg());image.type='image/jpeg';
  const metadata=await context.extractPhotoMeta(image,Date.UTC(2026,10,7));
  assert.ok(Math.abs(metadata.lat-31.2304)<1e-10);assert.ok(Math.abs(metadata.lng-121.4737)<1e-10);
  assert.equal(logs[0][0],'完整EXIF:');assert.ok(logs[0][1].GPSLatitude);
});
