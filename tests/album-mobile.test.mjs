import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css=await readFile('public/style.css','utf8'),app=await readFile('public/app.js','utf8');

test('mobile album uses a full-width single column with adaptive media',()=>{
  assert.match(css,/@media\(max-width:768px\)[\s\S]*?\.photo-grid\{grid-template-columns:minmax\(0,1fr\);gap:28px\}/);
  assert.match(css,/@media\(max-width:768px\)[\s\S]*?\.photo-item[^}]*width:100%/);
  assert.match(css,/@media\(max-width:768px\)[\s\S]*?\.photo-open img[^}]*aspect-ratio:4\/3[^}]*object-fit:cover/);
  const desktopGrid=css.lastIndexOf('.album-timeline .photo-grid{grid-template-columns:repeat(3,minmax(0,1fr))');
  const phoneGrid=css.lastIndexOf('.album-timeline .photo-grid{grid-template-columns:minmax(0,1fr)');
  assert.ok(phoneGrid>desktopGrid,'mobile one-column override must follow the higher-specificity desktop grid');
  assert.match(css,/\.album-timeline \.photo-grid>\.photo-item\{[^}]*width:100%[^}]*border-radius:12px[^}]*box-shadow:/);
  assert.match(css,/\.album-timeline \.photo-open img\{[^}]*width:100%[^}]*height:auto/);
  assert.match(css,/\.album-timeline \.photo-caption-entry p\{[^}]*display:-webkit-box[^}]*-webkit-line-clamp:2[^}]*overflow:hidden/);
  assert.match(css,/\.album-timeline \.photo-caption-entry\.is-addition p\{-webkit-line-clamp:2/);
  assert.match(css,/\.album-timeline \.photo-caption-entry time\{[^}]*color:#a29486/);
  assert.match(css,/\.album-timeline \.photo-caption-add\{[^}]*width:34px[^}]*height:34px/);
});

test('photo delete control is compact and requires native confirmation',()=>{
  assert.match(css,/\.photo-delete\{[^}]*position:absolute[^}]*right:17px[^}]*top:17px[^}]*background:rgba\(28,25,23,\.62\)[^}]*opacity:\.6/);
  assert.match(app,/confirm\('确定要移除这张照片吗？'\)/);
  assert.match(app,/data-remove-photo=.*?>×<\/button>/);
});

test('caption history is append-only in the UI and remains mobile-safe',()=>{
  assert.match(app,/data-add-photo-caption/);
  assert.match(app,/新留言会追加在原配文下方，原来的文字不会被覆盖/);
  assert.match(css,/\.photo-caption-entry p\{[^}]*white-space:pre-wrap[^}]*overflow-wrap:anywhere/);
});

test('timeline groups by year and month with a compact sort control',()=>{
  assert.match(app,/function groupAlbumPhotos/);
  assert.match(app,/data-toggle-album-month/);
  assert.match(app,/albumSort=albumSort==='desc'\?'asc':'desc'/);
  assert.match(css,/\.album-year>h3/);
  assert.match(css,/\.album-month-toggle\{[^}]*position:sticky/);
});

test('large months render in bounded lazy-loaded pages',()=>{
  assert.match(app,/ALBUM_MONTH_PAGE_SIZE=24/);
  assert.match(app,/month\.photos\.slice\(0,limit\)/);
  assert.match(app,/loading="lazy"/);
  assert.match(app,/data-more-album-month/);
});
