import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 版本号目前在 app/home.html 与 public/sw.js 里各写一遍，没有任何强制同步机制。
// 缓存键包含 ?v=，两处不一致时 Service Worker 预缓存的是另一把键，
// stale-while-revalidate 会一直命中旧缓存，用户永远拿不到新样式。
const ASSET_RE = /\/([\w.-]+\.(?:css|js))\?v=([\w.-]+)/g;

const collect = text => {
  const found = new Map();
  for (const match of text.matchAll(ASSET_RE)) found.set(match[1], match[2]);
  return found;
};

async function compare({ html, sw, htmlLabel, resolveAsset }) {
  const inHtml = collect(html);
  const inSw = collect(sw);
  const problems = [];

  if (!inHtml.size) problems.push(`${htmlLabel} 里没有解析到任何 ?v= 版本号`);
  if (!inSw.size) problems.push('sw.js 里没有解析到任何 STATIC_ASSETS 版本号');

  for (const [file, version] of inHtml) {
    if (!inSw.has(file)) { problems.push(`${file}?v=${version} 在 ${htmlLabel} 引用，但没出现在 sw.js 的 STATIC_ASSETS`); continue; }
    if (inSw.get(file) !== version) problems.push(`${file} 版本不一致：${htmlLabel}=${version}，sw.js=${inSw.get(file)}`);
  }

  // 预缓存清单里的文件必须真实存在：install 用 allSettled 吞掉单个失败，
  // 真缺文件时不会报错，只会让缓存不完整，所以在这里兜住。
  for (const file of inSw.keys()) {
    try { await access(resolveAsset(file)); }
    catch { problems.push(`sw.js 预缓存的 ${file} 不存在`); }
  }

  if (problems.length) {
    const error = new Error('静态资源版本校验失败：\n- ' + problems.join('\n- '));
    error.problems = problems;
    throw error;
  }
  return { count: inSw.size, versions: Object.fromEntries(inSw) };
}

/** 校验已生成的部署产物（dist-node / dist-supabase 等）。 */
export async function verifyAssetVersions(dir = '.') {
  const publicDir = resolve(dir, 'public');
  return compare({
    html: await readFile(resolve(publicDir, 'index.html'), 'utf8'),
    sw: await readFile(resolve(publicDir, 'sw.js'), 'utf8'),
    htmlLabel: 'index.html',
    resolveAsset: file => resolve(publicDir, file),
  });
}

/** 校验源码本身（app/home.html 与 public/sw.js）。CF 构建与 GitHub Pages 导出没有
 *  独立的 index.html + sw.js 组合产物，只能在这一层把关。 */
export async function verifySourceAssetVersions(root = '.') {
  return compare({
    html: await readFile(resolve(root, 'app/home.html'), 'utf8'),
    sw: await readFile(resolve(root, 'public/sw.js'), 'utf8'),
    htmlLabel: 'app/home.html',
    resolveAsset: file => resolve(root, 'public', file),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [dir = '.', mode = 'output'] = process.argv.slice(2);
  try {
    const result = mode === 'source' ? await verifySourceAssetVersions(dir) : await verifyAssetVersions(dir);
    console.log(`静态资源版本一致（${result.count} 个文件）：` + Object.entries(result.versions).map(([f, v]) => `${f}@${v}`).join(' '));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
