import { context, fail, json, parseObject, requireSameOrigin } from '../../../../../lib/home-server';
import { HomeError } from '../../../../../lib/home-domain.mjs';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{id: string}> };

export async function PATCH(req: Request, {params}: Params) {
  try {
    requireSameOrigin(req);
    const c = await context();
    const {id} = await params;
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 4000) throw new HomeError('位置信息过长。', 413);
    const body = parseObject(raw, '位置信息无效。');
    const latitude = body.latitude;
    const longitude = body.longitude;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new HomeError('请在地图上选择有效的位置。');
    }
    if (typeof body.locationName !== 'string' || /[\u0000-\u001f\u007f]/.test(body.locationName)) {
      throw new HomeError('请输入有效的地点名称。');
    }
    const locationName = body.locationName.trim();
    if (!locationName || locationName.length > 160) throw new HomeError('地点名称需为 1 至 160 个字符。');
    const photo = await c.db.prepare('SELECT id FROM photos WHERE id=?').bind(id).first();
    if (!photo) throw new HomeError('照片不存在。', 404);
    await c.db.prepare('UPDATE photos SET latitude=?,longitude=?,location_name=? WHERE id=?')
      .bind(latitude, longitude, locationName, id).run();
    return json({ok: true, id, latitude, longitude, location_name: locationName});
  } catch (error) { return fail(error); }
}
