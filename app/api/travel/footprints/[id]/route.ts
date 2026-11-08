import { context, fail, json, requireSameOrigin } from '../../../../../lib/home-server';
import { HomeError } from '../../../../../lib/home-domain.mjs';
import { storedTravelPhotos, travelPhotoKey } from '../../../../../lib/travel-footprint-media';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{id: string}> };

export async function DELETE(req: Request, {params}: Params) {
  try {
    requireSameOrigin(req);
    const c = await context(), {id} = await params;
    const row = await c.db.prepare('SELECT user_id,photos FROM travel_footprints WHERE id=?').bind(id)
      .first<{user_id: string; photos: string}>();
    if (!row) throw new HomeError('这个足迹已不存在。', 404);
    const photos = storedTravelPhotos(row.photos);
    const travelBucket = c.travelBucket;
    if (photos.length && !travelBucket) throw new HomeError('行舟记照片存储尚未配置。', 503);
    await c.db.prepare('DELETE FROM travel_footprints WHERE id=?').bind(id).run();
    let cleanupPending = false;
    for (const url of photos) {
      const match = new RegExp(`^/api/travel/footprints/${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/photos/([a-f0-9-]{36})$`).exec(url);
      if (!match) { cleanupPending = true; continue; }
      try { await travelBucket?.delete(await travelPhotoKey(row.user_id, id, match[1])); }
      catch (error) {
        cleanupPending = true;
        console.error('行舟记照片清理失败：', error instanceof Error ? error.message : 'unknown');
      }
    }
    return json({ok: true, cleanupPending});
  } catch (error) { return fail(error); }
}
