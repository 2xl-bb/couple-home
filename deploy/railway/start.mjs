import { mkdirSync, realpathSync, chownSync, statfsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
if (process.env.RAILWAY_ENVIRONMENT_ID && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  throw new Error('Attach the Railway persistent volume before deploying. Refusing ephemeral data storage.');
}
const origin = process.env.APP_ORIGIN || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
if (!origin || new URL(origin).protocol !== 'https:') throw new Error('Set APP_ORIGIN to the public HTTPS origin, or generate a Railway public domain.');
const volume = realpathSync(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.PERSIST_DIR || '/persist');
const dataDir = resolve(process.env.DATA_DIR || resolve(volume, 'data'));
const backupDir = resolve(process.env.BACKUP_DIR || resolve(volume, 'backups'));
for (const directory of [dataDir, backupDir]) {
  const child = relative(volume, directory);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Data and backup directories must be inside the persistent volume.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory) throw new Error('Persistent directories must not contain symbolic links.');
}
// Railway mounts new volumes as root. Prepare only our own directories, then
// permanently drop root before loading the application or accepting requests.
if (process.getuid?.() === 0) {
  for (const directory of [dataDir, backupDir, volume]) chownSync(directory, 1000, 1000);
  process.setgroups([]);
  process.setgid(1000);
  process.setuid(1000);
}
const root = fileURLToPath(new URL('./app/', import.meta.url));
const { createApplication } = await import(new URL('./app/application.mjs', import.meta.url));
const app = createApplication({
  root, dataDir, origin, trustProxy: false, setupCode: process.env.SETUP_CODE,
  albumAI: { baseURL: process.env.ALBUM_AI_BASE_URL, apiKey: process.env.ALBUM_AI_API_KEY,
    visionModel: process.env.ALBUM_AI_VISION_MODEL, embeddingModel: process.env.ALBUM_AI_EMBEDDING_MODEL },
});
const [handle] = app.server.listeners('request');
app.server.removeAllListeners('request');
let reserved = 0;
app.server.on('request', (request, response) => {
  // Railway checks a different Host. Permit only its read-only database health
  // endpoint; all application routes retain the original host and origin checks.
  if (request.headers.host === 'healthcheck.railway.app' && request.url === '/healthz' && request.method === 'GET') {
    try {
      app.db.raw.prepare('SELECT 1').get();
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end('{"ok":true}');
    } catch {
      response.writeHead(503, { 'Cache-Control': 'no-store' }); response.end();
    }
    return;
  }
  if (request.url === '/api/photos' && request.method === 'POST') {
    // Keep space for SQLite/WAL. Reserve the maximum upload size per concurrent
    // request so several uploads cannot collectively consume the safety margin.
    const reservation = 5 * 1024 * 1024;
    let enough = false;
    try {
      const fs = statfsSync(dataDir);
      enough = fs.bavail * fs.bsize - reserved >= 32 * 1024 * 1024 + reservation;
    } catch { /* Refuse uploads if free capacity cannot be determined. */ }
    if (!enough) {
      response.writeHead(507, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
      response.end(JSON.stringify({ error: '照片空间暂时不足，请先下载备份并整理相册。' }));
      request.resume(); return;
    }
    reserved += reservation;
    let released = false;
    const release = () => { if (!released) { released = true; reserved -= reservation; } };
    response.once('finish', release); response.once('close', release);
  }
  handle(request, response);
});
app.server.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Couple Home ready: ${origin}`);
  if (app.setupCode) console.log(process.env.SETUP_CODE
    ? '首次设置需要部署时私下配置的初始化码。'
    : '首次设置需要初始化码；请在私有持久卷 data/.setup-code 中查看。请勿公开该文件。');
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000); deadline.unref();
  try { await app.close(); clearTimeout(deadline); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
app.server.on('error', error => { console.error(error.message); app.db.close(); process.exitCode = 1; });
