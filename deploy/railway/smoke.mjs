import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';

const [base, container, mode = 'normal'] = process.argv.slice(2);
if (!base || new URL(base).hostname !== '127.0.0.1' || !/^couple-home-validation-[a-z0-9-]+$/.test(container || '')) {
  throw new Error('Use only a dedicated loopback test container: smoke.mjs http://127.0.0.1:PORT couple-home-validation-NAME [capacity]');
}
const origin = 'https://couple-home-validation.example';
const setupCode = 'isolated-container-test-setup-code';
const passwords = [randomUUID(), randomUUID()];
const reports = [];
const call = async (path, options = {}) => {
  // Use raw HTTP for a local reverse-proxy simulation: fetch can replace Host.
  const serialized = new Request(base + path, options);
  const body = Buffer.from(await serialized.arrayBuffer());
  const headers = Object.fromEntries(serialized.headers);
  headers.host = options.headers?.Host || new URL(origin).host;
  headers.connection = 'close';
  if (body.length) headers['content-length'] = String(body.length);
  return new Promise((resolveResponse, reject) => {
    const request = httpRequest(base + path, { method: serialized.method, headers }, incoming => {
      const chunks = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.on('error', reject);
      incoming.on('end', () => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) responseHeaders.append(key, item);
        }
        resolveResponse(new Response([204, 304].includes(incoming.statusCode) ? null : Buffer.concat(chunks), { status: incoming.statusCode, headers: responseHeaders }));
      });
    });
    request.on('error', reject); request.setTimeout(5000, () => request.destroy(new Error('Local test request timed out')));
    request.end(body);
  });
};
const send = (path, body, cookie, method = 'POST') => call(path, { method, headers: {
  Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
}, body: JSON.stringify(body) });
const get = (path, cookie) => call(path, { headers: cookie ? { Cookie: cookie } : {} });
async function ready() {
  let last;
  for (let i = 0; i < 40; i++) {
    try { const response = await get('/healthz'); if (response.status === 200) return; last = response.status; }
    catch (error) { last = error.message; }
    await delay(250);
  }
  throw new Error('Container readiness failed: ' + last);
}
await ready();
assert.equal((await call('/healthz', { headers: { Host: 'healthcheck.railway.app' } })).status, 200);
assert.equal((await call('/api/home', { headers: { Host: 'healthcheck.railway.app' } })).status, 400);
assert.equal((await call('/api/home', { headers: { 'oai-authenticated-user-email': 'forged@example.com' } })).status, 401);
reports.push('Railway health Host accepted only for health; forged identity rejected');
const entry = await (await get('/api/entry')).json();
assert.equal(entry.setupRequired, true); assert.equal(entry.requiresSetupCode, true);
const setup = { code: 'wrong', passwords, confirmations: passwords };
assert.equal((await send('/api/setup', setup)).status, 403);
const created = await send('/api/setup', { ...setup, code: setupCode });
assert.equal(created.status, 200, await created.clone().text());
const ownerHeader = created.headers.get('set-cookie');
assert.match(ownerHeader, /Secure/); assert.match(ownerHeader, /HttpOnly/); assert.match(ownerHeader, /SameSite=Strict/);
const owner = ownerHeader.split(';')[0];
assert.equal((await send('/api/setup', { ...setup, code: setupCode })).status, 409);
const login = await send('/api/auth', { slot: 2, password: passwords[1] });
assert.equal(login.status, 200);
const partner = login.headers.get('set-cookie').split(';')[0];
reports.push('Private first-run setup, two logins and HTTPS session attributes');
const photo = Buffer.alloc(mode === 'capacity' ? 3 * 1024 * 1024 : 64);
photo.set([255, 216, 255, 224]); photo.set([255, 217], photo.length - 2);
const upload = async () => {
  const form = new FormData();
  form.append('photo', new File([photo], 'synthetic.jpg', { type: 'image/jpeg' }));
  form.append('caption', 'isolated deployment verification');
  return call('/api/photos', { method: 'POST', headers: { Origin: origin, Cookie: owner }, body: form });
};
const uploaded = await upload();
assert.equal(uploaded.status, 200, await uploaded.clone().text());
const id = (await uploaded.json()).id;
assert.equal((await get('/api/photos/' + id)).status, 401);
assert.deepEqual(Buffer.from(await (await get('/api/photos/' + id, partner)).arrayBuffer()), photo);
assert.equal((await get('/api/backup', partner)).status, 403);
reports.push('Photo bytes preserved and private; second member cannot read administrator backup');
if (mode === 'capacity') {
  const refused = await upload();
  assert.equal(refused.status, 507);
  assert.match((await refused.json()).error, /空间/);
  assert.equal((await get('/healthz')).status, 200);
  assert.equal((await get('/api/home', owner)).status, 200);
  assert.equal((await send('/api/home', { id: randomUUID(), kind: 'wish.add', payload: {
    id: randomUUID(), text: 'Database remains writable after photo capacity limit',
  } }, partner)).status, 200);
  reports.push('Small filesystem rejects further photo upload while database remains readable and writable');
} else {
  const storyId = randomUUID();
  const saved = await send('/api/home', { id: randomUUID(), kind: 'story.add', payload: {
    id: storyId, title: 'Deployment fixture', text: 'Both members can read this test memory.', date: '2026-11-03',
  } }, owner);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await (await get('/api/home', partner)).json()).state.stories[0].id, storyId);
  const env = { ...process.env };
  for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[name];
  const docker = args => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { env, encoding: 'utf8', timeout: 30000 });
  const backupOutput = docker(['exec', '--user', '1000:1000', '-e', 'DATA_DIR=/persist/data', '-e', 'BACKUP_DIR=/persist/backups', container, 'node', '/app/app/backup.mjs']);
  assert.match(backupOutput, /备份完成并通过校验/);
  const snapshot = backupOutput.trim().split('：').at(-1);
  assert.match(snapshot, /^\/persist\/backups\/[a-zA-Z0-9.:-]+$/);
  assert.match(docker(['exec', '--user', '1000:1000', container, 'node', '/app/app/backup.mjs', '--verify', snapshot]), /备份校验通过/);
  reports.push('Container snapshot CLI creates and verifies database/photo snapshot');
  docker(['restart', container]); await ready();
  assert.equal((await (await get('/api/entry')).json()).setupRequired, false);
  assert.equal((await (await get('/api/home', partner)).json()).state.stories[0].id, storyId);
  assert.deepEqual(Buffer.from(await (await get('/api/photos/' + id, partner)).arrayBuffer()), photo);
  reports.push('Container restart preserves two accounts, timeline, photo and session');
  assert.equal((await call('/api/auth', { method: 'DELETE', headers: { Origin: origin, Cookie: owner } })).status, 200);
  assert.equal((await get('/api/home', owner)).status, 401);
  assert.equal((await get('/api/home', partner)).status, 200);
  reports.push('Logout revokes one member session without revoking the other');
}
console.log(JSON.stringify({ mode, passed: reports.length, checks: reports }, null, 2));
