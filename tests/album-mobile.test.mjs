import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css=await readFile('public/style.css','utf8'),app=await readFile('public/app.js','utf8');

// 注意：这个文件里的断言都只读 style.css / app.js 的**源码文本**，不渲染页面。
// 它们守的是「规则有没有写对、写在什么位置」，不能证明手机上的实际渲染结果。
// 真实渲染需要在浏览器/真机上量 getComputedStyle。

test('mobile album cascade: single-column rule is declared after the desktop grid (source order, not rendering)',()=>{
  assert.match(css,/@media\(max-width:768px\)[\s\S]*?\.photo-grid\{grid-template-columns:minmax\(0,1fr\);gap:28px\}/);
  assert.match(css,/@media\(max-width:768px\)[\s\S]*?\.photo-item[^}]*width:100%/);
  assert.match(css,/@media\(max-width:768px\)[\s\S]*?\.photo-open img[^}]*aspect-ratio:4\/3[^}]*object-fit:cover/);
  // 只校验级联顺序：桌面三列规则必须出现在手机单列规则之前，否则同特异性时后者会被反压。
  // 它**不是**「用户看到三列」那个 bug 的复现用例——旧版本靠 `1fr !important` 兜底，
  // 375px 下本来就是单列；旧版这条失败只说明顺序写错了，不说明渲染结果。
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

test('mobile album feed uses 16px gaps, 12px card padding and two-line clamps',()=>{
  assert.match(css,/\.album-timeline \.photo-grid\{grid-template-columns:minmax\(0,1fr\);gap:16px/);
  assert.match(css,/\.album-timeline \.photo-grid>\.photo-item\{[^}]*padding:12px[^}]*border-radius:12px[^}]*box-shadow:0 2px 10px/);
  assert.match(css,/\.album-timeline \.photo-caption-entry p\{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden/);
  assert.match(css,/\.album-timeline \.photo-caption-entry\.is-addition\{[^}]*border-radius:10px[^}]*background:#f3e9dc/);
  assert.doesNotMatch(css,/\.album-timeline \.photo-card|\.album-timeline \.photo-caption\{/,'dead timeline selectors from the earlier mobile patch must stay removed');
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
