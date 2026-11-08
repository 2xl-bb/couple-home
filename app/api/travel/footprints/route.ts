import { context, fail, json, parseObject, requireSameOrigin } from '../../../../lib/home-server';
import { HomeError } from '../../../../lib/home-domain.mjs';
import { travelPhotoKey, travelPhotoUrl } from '../../../../lib/travel-footprint-media';

export const dynamic = 'force-dynamic';
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

type FootprintRow = {
  id: string; user_id: string; city_name: string; name: string; lat: number; lng: number;
  photos: string; visit_date: string; note: string; color: string; created_at: number;
};

function decodePhotos(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_PHOTOS) throw new HomeError('每个足迹最多上传 8 张照片。');
  let total = 0;
  return value.map(photo => {
    if (typeof photo !== 'string') throw new HomeError('足迹照片格式无效。');
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
    if (!match || match[1].length % 4 !== 0) throw new HomeError('足迹照片必须是 JPEG 格式。');
    let binary: string;
    try { binary = atob(match[1]); }
    catch { throw new HomeError('足迹照片编码无效。'); }
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (bytes.length < 4 || bytes.length > MAX_PHOTO_BYTES ||
        bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 ||
        bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) {
      throw new HomeError('压缩后的照片大小不能超过 1 MB，并且必须是有效 JPEG。');
    }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new HomeError('每个足迹的照片总大小不能超过 4 MB。');
    return bytes;
  });
}

function text(value: unknown, name: string, maxLength: number, required = false) {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new HomeError(`${name}无效。`);
  }
  const result = value.trim();
  if (required && !result) throw new HomeError(`请填写${name}。`);
  return result;
}

function serialize(row: FootprintRow) {
  let photos: unknown;
  try { photos = JSON.parse(row.photos); }
  catch { throw new HomeError('云端足迹照片数据损坏，请联系管理员。', 500); }
  if (!Array.isArray(photos) || photos.some(photo => typeof photo !== 'string')) {
    throw new HomeError('云端足迹照片数据损坏，请联系管理员。', 500);
  }
  return {
    id: row.id, city: row.city_name, name: row.name, lat: Number(row.lat), lng: Number(row.lng),
    photos, date: row.visit_date, note: row.note, color: row.color, createdAt: Number(row.created_at),
    synced: true,
  };
}

async function findFootprint(db: Awaited<ReturnType<typeof context>>['db'], id: string) {
  return db.prepare('SELECT id,user_id,city_name,name,lat,lng,photos,visit_date,note,color,created_at FROM travel_footprints WHERE id=?')
    .bind(id).first<FootprintRow>();
}

export async function GET() {
  try {
    const c = await context();
    const result = await c.db.prepare('SELECT id,user_id,city_name,name,lat,lng,photos,visit_date,note,color,created_at FROM travel_footprints ORDER BY created_at,id')
      .all<FootprintRow>();
    return json({ footprints: result.results.map(serialize) });
  } catch (error) { return fail(error); }
}

export async function POST(req: Request) {
  const keys: string[] = [];
  let travelBucket: Awaited<ReturnType<typeof context>>['travelBucket'];
  try {
    requireSameOrigin(req);
    const c = await context();
    travelBucket = c.travelBucket;
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > 8 * 1024 * 1024) throw new HomeError('足迹照片请求太大，请减少照片数量后重试。', 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 8 * 1024 * 1024) throw new HomeError('足迹照片请求太大，请减少照片数量后重试。', 413);
    const input = parseObject(raw);
    const id = input.id;
    if (typeof id !== 'string' || !ID.test(id)) throw new HomeError('足迹编号无效。');
    const existing = await findFootprint(c.db, id);
    if (existing) return json({ footprint: serialize(existing), existed: true });

    const lat = input.lat, lng = input.lng;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new HomeError('足迹经纬度无效。');
    }
    const city = text(input.city, '城市', 80);
    const name = text(input.name, '地名', 120, true);
    const date = text(input.date, '日期', 10, true);
    const parsedDate = new Date(date + 'T00:00:00Z');
    if (!DATE.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new HomeError('足迹日期无效。');
    }
    const note = text(input.note, '感想', 1000);
    const color = typeof input.color === 'string' && COLOR.test(input.color) ? input.color : '#e8823c';
    const images = decodePhotos(input.photos);
    if (!travelBucket) throw new HomeError('行舟记照片存储尚未配置。', 503);
    const urls: string[] = [];
    for (const bytes of images) {
      const photoId = crypto.randomUUID();
      const key = await travelPhotoKey(c.member.userId, id, photoId);
      keys.push(key);
      await travelBucket.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
      urls.push(travelPhotoUrl(id, photoId));
    }
    const createdAt = Number.isSafeInteger(input.createdAt) && Number(input.createdAt) > 0 &&
      Number(input.createdAt) <= c.now + 86400000 ? Number(input.createdAt) : c.now;
    const inserted = await c.db.prepare(`INSERT OR IGNORE INTO travel_footprints
      (id,user_id,city_name,name,lat,lng,photos,visit_date,note,color,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, c.member.userId, city, name, lat, lng, JSON.stringify(urls), date, note, color, createdAt).run();
    if (!inserted.meta.changes) {
      const saved = await findFootprint(c.db, id);
      if (saved) {
        await Promise.all(keys.map(key => travelBucket.delete(key)));
        return json({ footprint: serialize(saved), existed: true });
      }
      throw new HomeError('保存足迹失败，请重试。', 503);
    }
    return json({footprint:{
      id, city, name, lat, lng, photos:urls, date, note, color, createdAt, synced:true,
    }}, 201);
  } catch (error) {
    if (keys.length) {
      try {
        await Promise.all(keys.map(key => travelBucket?.delete(key)));
      } catch (cleanupError) {
        console.error('行舟记照片清理失败：', cleanupError instanceof Error ? cleanupError.message : 'unknown');
      }
    }
    return fail(error);
  }
}
