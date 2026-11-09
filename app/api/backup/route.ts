import { requireNativeOwner } from '../../../lib/home-auth';
import { context, json, fail, snapshot } from '../../../lib/home-server';
import { HomeError } from '../../../lib/home-domain.mjs';
export const dynamic='force-dynamic';
// Archival access is deliberately separate from the time-sealed reading API.
// Only the pinned owner can archive unopened letters; no authentication tables leave D1.
export async function GET(){try{
 await requireNativeOwner();const c=await context();
 const [room,photos,captions]=await c.db.batch([
  c.db.prepare('SELECT data,revision,updated_at FROM room_state WHERE id=1'),
  c.db.prepare('SELECT id,caption,created_at,taken_at,latitude,longitude,location_name FROM photos ORDER BY taken_at,id'),
  c.db.prepare('SELECT id,photo_id,text,created_at,author_slot FROM photo_captions ORDER BY created_at,id'),
 ]);
 const row=room.results[0] as {data:string,revision:number,updated_at:number}|undefined;
 if(!row)throw new HomeError('小屋正在准备，请重试。',503);
 const state=JSON.parse(row.data);delete state.pet?.cooldowns;
 // 独立表不在 room_state 里。放进 state，前端导出会克隆整个 state 一并写进 JSON。
 state.archive=(await snapshot(c,{includeArchive:true})).state.archive;
 const byPhoto=new Map<string,unknown[]>();for(const item of captions.results as Array<{id:string,photo_id:string,text:string,created_at:number,author_slot:number}>){const list=byPhoto.get(item.photo_id)||[];list.push({id:item.id,text:item.text,createdAt:item.created_at,authorSlot:item.author_slot});byPhoto.set(item.photo_id,list)}
 return json({state:{...state,photos:(photos.results as Array<{id:string,caption:string,created_at:number,taken_at:Date|string|number,latitude:number|string|null,longitude:number|string|null,location_name:string|null}>).map(photo=>({...photo,taken_at:photo.taken_at instanceof Date?photo.taken_at.getTime():/^\d+$/.test(String(photo.taken_at))?Number(photo.taken_at):Date.parse(String(photo.taken_at)),latitude:photo.latitude===null?null:Number(photo.latitude),longitude:photo.longitude===null?null:Number(photo.longitude),location_name:photo.location_name||null,captions:byPhoto.get(photo.id)||[]}))},revision:row.revision,updatedAt:row.updated_at,exportedAt:new Date().toISOString()});
}catch(e){return fail(e)}}
