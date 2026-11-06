import { createHash, randomUUID } from 'node:crypto';
import { context, fail, json, parseObject, requireSameOrigin } from '../lib/home-server.ts';
import { HomeError } from '../lib/home-domain.mjs';

const ID = /^[a-f0-9-]{36}$/;
const TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

async function input(request) {
  const raw = await request.text();
  if (raw.length > 2000) throw new HomeError('视频请求过大。', 413);
  return parseObject(raw, '视频请求无效。');
}

function media(c) {
  if (!c.videoStore) throw new HomeError('视频存储尚未配置。', 503);
  return c.videoStore;
}

function memberPrefix(userId) {
  return createHash('sha256').update(userId).digest('hex');
}

export async function presign(request) { try {
  requireSameOrigin(request); const c = await context(), store = media(c), body = await input(request);
  const contentType = typeof body.contentType === 'string' ? body.contentType.toLowerCase() : '';
  const sizeBytes = Number(body.sizeBytes), caption = String(body.caption || '').trim().slice(0, 80);
  if (!TYPES.has(contentType) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 500 * 1024 * 1024) {
    throw new HomeError('视频须为 MP4、WebM 或 MOV，且不超过 500 MB。');
  }
  const count = await c.db.prepare("SELECT COUNT(*) AS n FROM videos WHERE status='ready'").first();
  if ((count?.n || 0) >= 200) throw new HomeError('小屋暂时最多保存 200 段视频。');
  const id = randomUUID(), objectKey = `videos/${memberPrefix(c.member.userId)}/${id}`;
  await c.db.prepare("INSERT INTO videos (id,object_key,caption,content_type,size_bytes,created_at,user_id,owner_slot,status) VALUES (?,?,?,?,?,?,?,?,'pending')")
    .bind(id, objectKey, caption, contentType, sizeBytes, c.now, c.member.userId, c.member.slot).run();
  try {
    const uploadUrl = await store.createUpload({ key: objectKey, contentType, sizeBytes });
    return json({ id, uploadUrl, contentType, expiresIn: 600 }, 201);
  } catch (error) {
    await c.db.prepare('DELETE FROM videos WHERE id=?').bind(id).run();
    throw error;
  }
} catch (error) { return fail(error); } }

export async function complete(request, id) { try {
  requireSameOrigin(request); if (!ID.test(id)) throw new HomeError('视频编号无效。');
  const c = await context(), store = media(c);
  const row = await c.db.prepare("SELECT object_key,content_type,size_bytes FROM videos WHERE id=? AND status='pending'")
    .bind(id).first();
  if (!row) throw new HomeError('视频上传申请不存在或已经完成。', 404);
  await store.complete({ key: row.object_key, contentType: row.content_type, sizeBytes: row.size_bytes });
  const saved = await c.db.prepare("UPDATE videos SET status='ready' WHERE id=? AND status='pending'")
    .bind(id).run();
  if (saved.meta.changes !== 1) throw new HomeError('视频状态已经改变，请刷新。', 409);
  return json({ ok: true, id });
} catch (error) { return fail(error); } }

export async function download(_request, id) { try {
  if (!ID.test(id)) throw new HomeError('视频编号无效。');
  const c = await context(), store = media(c);
  const row = await c.db.prepare("SELECT object_key FROM videos WHERE id=? AND status='ready'")
    .bind(id).first();
  if (!row) throw new HomeError('视频不存在。', 404);
  return json({ url: await store.createDownload({ key: row.object_key }), expiresIn: 120 });
} catch (error) { return fail(error); } }

export async function remove(request, id) { try {
  requireSameOrigin(request); if (!ID.test(id)) throw new HomeError('视频编号无效。');
  const c = await context(), store = media(c);
  const row = await c.db.prepare('SELECT object_key FROM videos WHERE id=?')
    .bind(id).first();
  if (!row) throw new HomeError('视频已被移除。', 404);
  await store.delete(row.object_key);
  await c.db.prepare('DELETE FROM videos WHERE id=?').bind(id).run();
  return json({ ok: true });
} catch (error) { return fail(error); } }
