import { context, fail } from '../../../../../../../lib/home-server';
import { HomeError } from '../../../../../../../lib/home-domain.mjs';
import { storedTravelPhotos, travelPhotoKey, travelPhotoUrl } from '../../../../../../../lib/travel-footprint-media';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{id: string; photoId: string}> };

export async function GET(_req: Request, {params}: Params) {
  try {
    const c = await context(), {id, photoId} = await params;
    const row = await c.db.prepare('SELECT user_id,photos FROM travel_footprints WHERE id=?').bind(id)
      .first<{user_id: string; photos: string}>();
    if (!row || !storedTravelPhotos(row.photos).includes(travelPhotoUrl(id, photoId))) {
      throw new HomeError('足迹照片不存在。', 404);
    }
    if (!c.travelBucket) throw new HomeError('行舟记照片存储尚未配置。', 503);
    const object = await c.travelBucket.get(await travelPhotoKey(row.user_id, id, photoId));
    if (!object) throw new HomeError('足迹照片暂时无法读取。', 404);
    return new Response(object.body, {headers: {
      'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    }});
  } catch (error) { return fail(error); }
}
