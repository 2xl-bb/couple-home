import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseBucket } from '../server/supabase/storage.mjs';

const ID = '00000000-0000-4000-8000-000000000001';
const KEY = `photos/${ID}`;
const SECRET = 'sb_secret_local_test_only';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

function fixture() {
  const calls = [];
  const objects = new Map();
  const bucket = createSupabaseBucket({
    url: 'https://example.supabase.co',
    serviceKey: SECRET,
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      const path = new URL(url).pathname;
      if (path.includes('/object/public/')) throw new Error('public object path used');
      const key = path.slice(path.indexOf('/photos/'));
      if (init.method === 'POST') {
        if (objects.has(key)) return new Response(null, { status: 409 });
        objects.set(key, Buffer.from(init.body));
        return new Response('{}', { status: 200 });
      }
      if (init.method === 'GET') {
        const data = objects.get(key);
        return data ? new Response(data, { status: 200 }) : new Response(null, { status: 404 });
      }
      if (init.method === 'DELETE') {
        return new Response(null, { status: objects.delete(key) ? 200 : 404 });
      }
      throw new Error(`unexpected method: ${init.method}`);
    },
  });
  return { bucket, calls, objects };
}

test('private JPEG upload, read, and delete use only the server secret header', async () => {
  const { bucket, calls } = fixture();
  await bucket.put(KEY, JPEG, { httpMetadata: { contentType: 'image/jpeg' } });
  assert.deepEqual((await bucket.get(KEY)).body, JPEG);
  await bucket.delete(KEY);
  assert.equal(await bucket.get(KEY), null);
  await bucket.delete(KEY);

  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'DELETE', 'GET', 'DELETE']);
  assert.equal(new URL(calls[0].url).pathname,
    `/storage/v1/object/couple-photos/${KEY}`);
  assert.equal(new URL(calls[1].url).pathname,
    `/storage/v1/object/authenticated/couple-photos/${KEY}`);
  assert.equal(calls[0].headers.apikey, SECRET);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].headers['content-type'], 'image/jpeg');
  assert.equal(calls[0].headers['x-upsert'], 'false');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].body.equals(JPEG), true);
  assert.equal(calls.every(call => !call.url.includes(SECRET)), true);
});

test('retrying an identical object succeeds without overwriting; different bytes fail', async () => {
  const { bucket, calls } = fixture();
  await bucket.put(KEY, JPEG);
  await bucket.put(KEY, JPEG);
  await assert.rejects(bucket.put(KEY, Buffer.from([0xff, 0xd8, 0xff, 0x01])), /HTTP 409/);
  assert.deepEqual((await bucket.get(KEY)).body, JPEG);
  assert.equal(calls.filter(call => call.method === 'GET').length, 3);
});

test('invalid storage keys and non-JPEG metadata are rejected before network access', async () => {
  const { bucket, calls } = fixture();
  for (const key of ['photos/../private', 'photos/a%2fb', '/photos/' + ID,
    'photos/' + ID + '?download=1', 'other/' + ID]) {
    await assert.rejects(bucket.put(key, JPEG), /无效的照片存储键/);
    await assert.rejects(bucket.get(key), /无效的照片存储键/);
    await assert.rejects(bucket.delete(key), /无效的照片存储键/);
  }
  await assert.rejects(bucket.put(KEY, JPEG, { httpMetadata: { contentType: 'text/html' } }),
    /JPEG/);
  assert.equal(calls.length, 0);
});

test('new secret keys and legacy service_role JWTs have distinct headers', async () => {
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const legacy = `header.${payload}.signature`;
  let observed;
  const bucket = createSupabaseBucket({
    url: 'https://example.supabase.co', serviceKey: legacy,
    fetchImpl: async (_url, init) => { observed = init.headers; return new Response(null, { status: 404 }); },
  });
  assert.equal(await bucket.get(KEY), null);
  assert.equal(observed.apikey, legacy);
  assert.equal(observed.Authorization, `Bearer ${legacy}`);
  assert.throws(() => createSupabaseBucket({ url: 'https://example.supabase.co', serviceKey: 'sb_publishable_not_secret' }),
    /无效的 Supabase 服务端密钥/);
});

test('configuration and transport errors do not disclose the secret key', async () => {
  assert.throws(() => createSupabaseBucket({ url: 'http://example.supabase.co', serviceKey: SECRET }), /HTTPS/);
  assert.throws(() => createSupabaseBucket({ url: 'https://user:pass@example.supabase.co', serviceKey: SECRET }), /HTTPS/);
  assert.throws(() => createSupabaseBucket({ url: 'https://example.supabase.co/extra', serviceKey: SECRET }), /HTTPS/);
  const bucket = createSupabaseBucket({ url: 'https://example.supabase.co', serviceKey: SECRET,
    fetchImpl: async () => { throw new Error(`internal detail ${SECRET}`); } });
  await assert.rejects(bucket.get(KEY), error => {
    assert.equal(error.message.includes(SECRET), false);
    assert.match(error.message, /连接失败.*internal detail \[REDACTED\]/);
    assert.equal(error.code, 'SUPABASE_STORAGE_NETWORK_ERROR');
    assert.match(error.stack, /SupabaseStorageError/);
    return true;
  });
  const denied = createSupabaseBucket({ url: 'https://example.supabase.co', serviceKey: SECRET,
    fetchImpl: async () => new Response(`server detail ${SECRET}`, { status: 403 }) });
  await assert.rejects(denied.get(KEY), error => {
    assert.equal(error.message.includes(SECRET), false);
    return /HTTP 403/.test(error.message);
  });
});

test('startup health check accepts only an existing private bucket', async () => {
  const make = value => createSupabaseBucket({ url: 'https://example.supabase.co', serviceKey: SECRET,
    fetchImpl: async (_url, init) => new Response(JSON.stringify(value), { status: 200,
      headers: { 'Content-Type': 'application/json' } }) });
  await make({ id: 'couple-photos', public: false }).health();
  await assert.rejects(make({ id: 'couple-photos', public: true }).health(), /Private/);
  const missing = createSupabaseBucket({ url: 'https://example.supabase.co', serviceKey: SECRET,
    fetchImpl: async () => new Response(null, { status: 404 }) });
  await assert.rejects(missing.health(), error => {
    assert.match(error.message, /HTTP 404/);
    assert.equal(error.status, 404);
    assert.equal(error.code, 'SUPABASE_STORAGE_HTTP_ERROR');
    return true;
  });
});

test('transport diagnostics preserve nested network codes without exposing credentials', async () => {
  const cause = Object.assign(new Error('connect ETIMEDOUT 203.0.113.1:443'), { code: 'ETIMEDOUT' });
  const bucket = createSupabaseBucket({ url: 'https://example.supabase.co', serviceKey: SECRET,
    fetchImpl: async () => { throw new TypeError('fetch failed', { cause }); } });
  await assert.rejects(bucket.health(), error => {
    assert.equal(error.code, 'ETIMEDOUT');
    assert.match(error.message, /TypeError: fetch failed.*ETIMEDOUT.*203\.0\.113\.1:443/);
    assert.equal(error.message.includes(SECRET), false);
    return true;
  });
});
