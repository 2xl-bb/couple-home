import { context, fail, json, parseObject, requireSameOrigin } from '../../../../../lib/home-server';
import { HomeError } from '../../../../../lib/home-domain.mjs';
export const dynamic='force-dynamic';
type Params={params:Promise<{id:string}>};

export async function PATCH(req:Request,{params}:Params){try{
  requireSameOrigin(req);const c=await context(),{id}=await params;
  const raw=await req.text();if(raw.length>1000)throw new HomeError('日期内容过长。',413);
  const body=parseObject(raw,'拍摄日期无效。'),takenAt=Date.parse(String(body.takenAt||''));
  if(!Number.isFinite(takenAt)||takenAt<=0||takenAt>c.now+86400000)throw new HomeError('拍摄日期无效。');
  const photo=await c.db.prepare('SELECT id FROM photos WHERE id=?').bind(id).first();
  if(!photo)throw new HomeError('照片不存在。',404);
  await c.db.prepare('UPDATE photos SET taken_at=? WHERE id=?').bind(new Date(takenAt).toISOString(),id).run();
  return json({ok:true,id,takenAt});
}catch(e){return fail(e)}}
