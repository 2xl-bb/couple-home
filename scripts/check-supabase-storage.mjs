import { existsSync } from 'node:fs';
import process from 'node:process';
import { createSupabaseBucket } from '../server/supabase/storage.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_BUCKET || 'couple-photos';

if (!url) throw new Error('缺少 SUPABASE_URL。');
if (!serviceKey) throw new Error('缺少 SUPABASE_SECRET_KEY 或 SUPABASE_SERVICE_ROLE_KEY。');

let host;
try { host = new URL(url).host; }
catch { throw new Error('SUPABASE_URL 不是有效网址。'); }

const keyType = serviceKey.startsWith('sb_secret_') ? 'sb_secret_' : 'legacy service_role JWT';
const proxyConfigured = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);
const envProxyEnabled = process.execArgv.includes('--use-env-proxy');
const envLoadedAtStartup = process.execArgv.some(value => value === '--env-file' || value.startsWith('--env-file='));

console.log('Supabase Storage 独立检查：', {
  host,
  bucket: bucketName,
  keyType,
  proxyConfigured,
  envProxyEnabled,
});
if (proxyConfigured && !envProxyEnabled) {
  console.warn('检测到代理环境变量，但 Node 未启用 --use-env-proxy；网络请求可能绕过本地代理。');
}
if (proxyConfigured && envProxyEnabled && !envLoadedAtStartup) {
  console.warn('代理变量若写在 .env 中，必须用 --env-file=.env 在 Node 启动阶段加载，脚本运行后加载会太晚。');
}

const bucket = createSupabaseBucket({ url, serviceKey, bucket: bucketName });
try {
  await bucket.health();
  console.log(`连接成功：私有桶 ${bucketName} 可访问。`);
} catch (error) {
  console.error('连接失败：', {
    message: error instanceof Error ? error.message : String(error),
    status: Number.isInteger(error?.status) ? error.status : undefined,
    code: typeof error?.code === 'string' ? error.code : undefined,
  });
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exitCode = 1;
}
