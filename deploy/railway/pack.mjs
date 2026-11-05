import { cp, mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
await mkdir(resolve(root, '.sites-runtime'), { recursive: true });
const output = await mkdtemp(resolve(root, '.sites-runtime/railway-release-'));
const app = resolve(output, 'app');
await mkdir(app);
// Explicit allowlist: never copy the checkout, .env, data, photos, backups,
// node_modules, CLI authentication, or development state into a deploy archive.
for (const name of ['server.mjs', 'application.mjs', 'admin.mjs', 'backup.mjs']) {
  await copyFile(resolve(root, 'dist-node', name), resolve(app, name));
}
await mkdir(resolve(app, 'public'));
for (const name of ['index.html', 'app.js', 'entry.js', 'pet-view.js', 'features.js', 'room-helpers.js', 'album.js', 'style.css', 'favicon.svg']) {
  await copyFile(resolve(root, 'dist-node/public', name), resolve(app, 'public', name));
}
await cp(resolve(root, 'drizzle'), resolve(app, 'drizzle'), { recursive: true });
for (const name of ['Dockerfile', 'start.mjs', 'README.md', 'VALIDATION.md', 'CLI.md']) {
  await copyFile(resolve(root, 'deploy/railway', name), resolve(output, name));
}
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(resolve(root, name), resolve(output, name));
await writeFile(resolve(output, 'build-info.json'), JSON.stringify({
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  builtAt: new Date().toISOString(), runtime: 'node:24.19.0-bookworm-slim',
  note: 'Includes standalone deployment adapters; no user data or credentials.',
}, null, 2) + '\n');
console.log(output);
