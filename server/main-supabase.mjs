import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './application.mjs';
import { createSupabaseEntry } from './supabase-entry.mjs';
import { openPostgres } from './postgres.mjs';
import { createSupabaseBucket } from './supabase/storage.mjs';
import { createR2VideoStore } from './r2-video.mjs';
import { createStorageAdapters } from './storage.mjs';

process.umask(0o077);
const root = fileURLToPath(new URL('./', import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const origin = process.env.APP_ORIGIN;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效。');
if (!origin) throw new Error('请设置公开 HTTPS 地址 APP_ORIGIN。');
for (const name of ['DATABASE_URL', 'SUPABASE_URL', 'SETUP_CODE', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
  if (!process.env[name]) throw new Error(`缺少环境变量 ${name}。`);
}
const storageKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!storageKey) throw new Error('缺少环境变量 SUPABASE_SECRET_KEY 或 SUPABASE_SERVICE_ROLE_KEY。');

function logHealthFailure(label, error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  console.error(`${label}：`, { message, status, code });
  if (error instanceof Error && error.stack) console.error(error.stack);
}

const db = await openPostgres({ connectionString: process.env.DATABASE_URL, schemaPath: resolve(root, 'schema.sql'), migrationsPath: resolve(root, 'migrations') });
let app;
let videoStore;
try {
  const bucket = createSupabaseBucket({ url: process.env.SUPABASE_URL,
    serviceKey: storageKey, bucket: process.env.SUPABASE_BUCKET || 'couple-photos' });
  videoStore = createR2VideoStore({ accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET_NAME });
  try { await bucket.health(); }
  catch (error) {
    logHealthFailure('Supabase Storage 健康检查失败', error);
    throw error;
  }
  await videoStore.health();
  app = createApplication({ root, origin, database: db, storage: createStorageAdapters({ photos: bucket, videos: videoStore }), entryFactory: createSupabaseEntry,
    setupCode: process.env.SETUP_CODE, albumAI: {
      baseURL: process.env.ALBUM_AI_BASE_URL, apiKey: process.env.ALBUM_AI_API_KEY,
      visionModel: process.env.ALBUM_AI_VISION_MODEL, embeddingModel: process.env.ALBUM_AI_EMBEDDING_MODEL,
    } });
  await new Promise((done, fail) => { app.server.once('error', fail); app.server.listen(port, host, done); });
  console.log(`我们的小日子已启动：${origin}`);
} catch (error) {
  await app?.close().catch(() => {});
  if (!app) { await db.close().catch(() => {}); await videoStore?.close().catch(() => {}); }
  throw error;
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await app.close(); }
  catch (error) { console.error('关闭服务失败：', error.message); process.exitCode = 1; }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
