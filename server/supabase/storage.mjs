// This adapter is server-only. Callers must check the Couple Home member session
// and photo access before invoking it; the Supabase secret key bypasses RLS.
const PHOTO_KEY = /^photos\/(?:[a-f0-9]{64}\/)?(?:[a-f0-9]{8}-[a-f0-9-]{27}|import-[a-f0-9]{64})$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function objectKey(key) {
  if (typeof key !== 'string' || !PHOTO_KEY.test(key)) {
    throw new Error('无效的照片存储键');
  }
  return key.split('/').map(encodeURIComponent).join('/');
}

function projectOrigin(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error('无效的 Supabase 项目地址'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Supabase 项目地址必须是 HTTPS 根地址');
  }
  return parsed.origin;
}

function keyHeaders(key) {
  if (typeof key !== 'string' || !key) throw new Error('缺少 Supabase 服务端密钥');
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return { apikey: key };

  // Legacy service_role JWTs still need a Bearer header. The new sb_secret_
  // keys are not JWTs and must only be sent in the apikey header.
  const pieces = key.split('.');
  try {
    if (pieces.length === 3 &&
        JSON.parse(Buffer.from(pieces[1], 'base64url').toString('utf8')).role === 'service_role') {
      return { apikey: key, Authorization: `Bearer ${key}` };
    }
  } catch { /* An invalid key is rejected below without echoing its value. */ }
  throw new Error('无效的 Supabase 服务端密钥');
}

export function createSupabaseBucket({ url, serviceKey, bucket = 'couple-photos', fetchImpl = fetch }) {
  const origin = projectOrigin(url);
  if (typeof bucket !== 'string' || !BUCKET_NAME.test(bucket)) {
    throw new Error('无效的 Supabase 存储桶名称');
  }
  if (typeof fetchImpl !== 'function') throw new Error('缺少 Fetch 实现');
  const headers = keyHeaders(serviceKey);
  const objectBase = `${origin}/storage/v1/object/${encodeURIComponent(bucket)}/`;
  const privateBase = `${origin}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/`;

  async function request(target, init) {
    let response;
    try {
      response = await fetchImpl(target, {
        ...init,
        headers: { ...headers, ...init.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      // In particular, never include a failed request's headers or response body.
      throw new Error('Supabase 照片存储连接失败');
    }
    return response;
  }

  async function get(key) {
    const response = await request(privateBase + objectKey(key), { method: 'GET' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Supabase 照片读取失败 (HTTP ${response.status})`);
    return { body: Buffer.from(await response.arrayBuffer()) };
  }

  return {
    async health() {
      const response = await request(`${origin}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { method: 'GET' });
      if (!response.ok) throw new Error(`Supabase 私有照片桶不可用 (HTTP ${response.status})`);
      let details;
      try { details = await response.json(); } catch { throw new Error('Supabase 照片桶配置无法读取'); }
      if (details?.public !== false) throw new Error('Supabase 照片桶必须设置为 Private');
    },
    async put(key, bytes, options = {}) {
      const path = objectKey(key);
      if (options?.httpMetadata?.contentType && options.httpMetadata.contentType !== 'image/jpeg') {
        throw new Error('照片必须是 JPEG 格式');
      }
      const body = Buffer.from(bytes);
      const response = await request(objectBase + path, {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=0', 'x-upsert': 'false' },
        body,
      });
      if (response.status === 409) {
        // A previous upload may have succeeded before its database insert did.
        // Retrying the same bytes is safe; a different object must not be replaced.
        const existing = await get(key);
        if (existing?.body.equals(body)) return;
      }
      if (!response.ok) throw new Error(`Supabase 照片上传失败 (HTTP ${response.status})`);
    },
    get,
    async delete(key) {
      const response = await request(objectBase + objectKey(key), { method: 'DELETE' });
      if (response.status === 404) return;
      if (!response.ok) throw new Error(`Supabase 照片删除失败 (HTTP ${response.status})`);
    },
  };
}
