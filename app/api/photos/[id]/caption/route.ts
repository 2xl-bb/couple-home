import { context, fail, json, parseObject, requireSameOrigin } from '../../../../../lib/home-server';
import { HomeError } from '../../../../../lib/home-domain.mjs';
export const dynamic='force-dynamic';
type Params={params:Promise<{id:string}>};
const CAPTION_ID=/^[a-zA-Z0-9_-]{8,100}$/;

export async function POST(req:Request,{params}:Params){try{
  requireSameOrigin(req);const c=await context(),{id:photoId}=await params;
  const raw=await req.text();if(raw.length>2000)throw new HomeError('留言内容过长。',413);
  const body=parseObject(raw,'留言内容无效。'),text=String(body.text||'').trim();
  if(!text||text.length>500)throw new HomeError('请输入 1 至 500 个字符的留言。');
  const createdAt=body.createdAt===undefined?c.now:Number(body.createdAt);
  if(!Number.isSafeInteger(createdAt)||createdAt<=0||createdAt>c.now)throw new HomeError('留言时间无效。');
  const requestedId=typeof body.id==='string'?body.id:'',captionId=requestedId||crypto.randomUUID();
  if(!CAPTION_ID.test(captionId))throw new HomeError('留言编号无效。');
  const photo=await c.db.prepare('SELECT id FROM photos WHERE id=?').bind(photoId).first();
  if(!photo)throw new HomeError('照片不存在。',404);
  const inserted=await c.db.prepare('INSERT OR IGNORE INTO photo_captions (id,photo_id,text,created_at,user_id,author_slot) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM photo_captions WHERE photo_id=?)<100')
    .bind(captionId,photoId,text,createdAt,c.member.userId,c.member.slot,photoId).run();
  if(!inserted.meta.changes){
    const saved=await c.db.prepare('SELECT photo_id,text,created_at FROM photo_captions WHERE id=?').bind(captionId).first<{photo_id:string,text:string,created_at:number}>();
    if(saved?.photo_id===photoId&&saved.text===text&&saved.created_at===createdAt)return json({ok:true,id:captionId,text,createdAt,authorSlot:c.member.slot,existed:true});
    throw new HomeError(saved?'留言编号已被使用。':'每张照片最多追加 100 条留言。',saved?409:400);
  }
  await c.db.prepare('DELETE FROM photo_ai WHERE photo_id=?').bind(photoId).run();
  return json({ok:true,id:captionId,text,createdAt,authorSlot:c.member.slot},201);
}catch(e){return fail(e)}}
