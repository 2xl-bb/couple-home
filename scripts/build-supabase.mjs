import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist-supabase');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('drizzle-kit'))('esbuild');

await mkdir(resolve(output, 'public'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: { server: 'server/main-supabase.mjs', application: 'server/application.mjs' },
  outdir: output,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.18',
  outExtension: { '.js': '.mjs' },
  external: ['pg', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
  plugins: [{ name: 'standalone-runtime', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: resolve(root, 'server/request-context.mjs') }));
    builder.onResolve({ filter: /(?:^|\/)home-auth(?:\.ts)?$/ }, () => ({ path: resolve(root, 'server/auth.mjs') }));
    builder.onResolve({ filter: /(?:^|\/)password\.mjs$/ }, () => ({ path: resolve(root, 'server/password.mjs') }));
  } }],
});

let html = await readFile(resolve(root, 'app/home.html'), 'utf8');
html = html.replace(/<a class="owner-login-link"[^>]*>.*?<\/a>/, '')
  .replace('首次入住？管理员先进入「双人设置」，为两位成员设置密码。', '<span id="entry-help">首次使用可以直接在这里设置密码。</span>')
  .replace('<script src="/app.js', '<script src="/entry.js" defer></script><script src="/app.js')
  .replace('<head>', '<head><script>window.LITTLE_DAYS_STANDALONE=true;</script>');
if (!html.includes('id="entry-help"') || !html.includes('src="/entry.js"')) {
  throw new Error('首次设置入口模板未正确生成。');
}
await writeFile(resolve(output, 'public/index.html'), html);
for (const name of ['app.js', 'entry.js', 'pet-view.js', 'features.js', 'room-helpers.js', 'album.js', 'style.css', 'favicon.svg', 'manifest.json', 'sw.js', 'icon-192.svg', 'icon-512.svg', 'icon-192.png', 'icon-512.png']) {
  await cp(resolve(root, 'public', name), resolve(output, 'public', name));
}
await cp(resolve(root, 'deploy/render-supabase/schema.sql'), resolve(output, 'schema.sql'));
await cp(resolve(root, 'deploy/render-supabase/migrations'), resolve(output, 'migrations'), { recursive: true });
await cp(resolve(root, 'drizzle'), resolve(output, 'drizzle'), { recursive: true });
await cp(resolve(root, 'deploy/render-supabase/README.md'), resolve(output, 'README.md'));
await writeFile(resolve(output, 'package.json'), JSON.stringify({
  name: 'couple-home-render-supabase',
  private: true,
  type: 'module',
  engines: { node: '>=22.18.0' },
  scripts: { start: 'node server.mjs' },
  dependencies: { pg: '8.23.1', '@aws-sdk/client-s3': '3.1160.0', '@aws-sdk/s3-request-presigner': '3.1160.0' },
}, null, 2));
console.log('Render + Supabase 部署包已生成：' + output);
