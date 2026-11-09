import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 版本号目前在 app/home.html 与 public/sw.js 里各写一遍，没有任何强制同步机制。
// 这个校验在构建期比对产物中的两份副本，不一致就让构建失败，
// 避免「缓存键对不上 → stale-while-revalidate 永远命中旧键 → 用户拿不到新样式」。
const ASSET_RE = /\/([\w.-]+\.(?:css|js))\?v=([\w.-]+)/g;

const collect = text => {
  const found = new Map();
  for (const match of text.matchAll(ASSET_RE)) found.set(match[1], match[2]);
  return found;
};

export async function verifyAssetVersions(dir = '.') {
  const publicDir = resolve(dir, 'public');
  const html = await readFile(resolve(publicDir, 'index.html'), 'utf8');
  const sw = await readFile(resolve(publicDir, 'sw.js'), 'utf8');

  // HTML 里带 ?v= 的资源不一定全部预缓存（例如 features.js 早期没进清单），
  // 但只要有同名文件出现在 STATIC_ASSETS 中，版本就必须一致；反之漏掉则明确报错。
  const inHtml = collect(html);
  const inSw = collect(sw);
  const problems = [];

  if (!inHtml.size) problems.push('index.html 里没有解析到任何 ?v= 版本号');
  if (!inSw.size) problems.push('sw.js 里没有解析到任何 STATIC_ASSETS 版本号');

  for (const [file, version] of inHtml) {
    if (!inSw.has(file)) { problems.push(`${file}?v=${version} 在 index.html 引用，但没出现在 sw.js 的 STATIC_ASSETS`); continue; }
    if (inSw.get(file) !== version) problems.push(`${file} 版本不一致：index.html=${version}，sw.js=${inSw.get(file)}`);
  }

  // 预缓存清单里的文件必须真实存在：install 用 allSettled 吞掉单个失败，
  // 真缺文件时不会报错，只会让缓存不完整，所以在这里兜住。
  for (const file of inSw.keys()) {
    try { await access(resolve(publicDir, file)); }
    catch { problems.push(`sw.js 预缓存的 ${file} 在产物目录里不存在`); }
  }

  if (problems.length) {
    const error = new Error('静态资源版本校验失败：\n- ' + problems.join('\n- '));
    error.problems = problems;
    throw error;
  }
  return { count: inSw.size, versions: Object.fromEntries(inSw) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = process.argv[2] || '.';
  try {
    const result = await verifyAssetVersions(dir);
    console.log(`静态资源版本一致（${result.count} 个文件）：` + Object.entries(result.versions).map(([f, v]) => `${f}@${v}`).join(' '));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
