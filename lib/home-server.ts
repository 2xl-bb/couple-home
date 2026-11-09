import { env } from 'cloudflare:workers';
import { homeIdentity } from './home-auth';
import { publicState, HomeError } from './home-domain.mjs';
import { ensureMember } from './home-repository.mjs';
import { matchesPagesOrigin } from './pages-origin';
import { homeSyncTag } from './home-sync-tag.mjs';
import { publicPhotoAI } from './album-ai.mjs';
import { collectArchivedTables } from './backup-archive.mjs';

export function json(data: unknown, status=200) { return Response.json(data, {status,headers:{'Cache-Control':'no-store','Vary':'Cookie'}}); }
export function parseObject(raw:string, message='请求内容无效。') {
  let value;try{value=JSON.parse(raw)}catch{throw new HomeError(message);}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HomeError(message);
  return value;
}
export function fail(e: unknown) {
  if(e instanceof HomeError) return json({error:e.message}, e.status);
  console.error('Home request failed',e instanceof Error?e.message:'unknown');
  return json({error:'小屋暂时没有连接上，请稍后重试。'},503);
}
export function requireSameOrigin(req: Request) {
  const origin=req.headers.get('origin');
  if(!origin||(origin!==new URL(req.url).origin&&!matchesPagesOrigin(origin,env.PAGES_ORIGIN)))throw new HomeError('请从小屋页面执行这个操作。',403);
}
export async function context() {
  const identity=await homeIdentity(),u=identity.user;
  if(!env.DB||!env.BUCKET)throw new HomeError('云端空间正在准备，请稍后重试。',503);
  const db=env.DB, now=Date.now();
  // Only the pinned owner or a valid home-key session can reach shared records.
  const member=await ensureMember(db,u,now);
  return {db,bucket:env.BUCKET,travelBucket:env.TRAVEL_BUCKET||env.BUCKET,videoStore:env.VIDEO_STORE||null,member,now,canManagePasswords:identity.nativeOwner,loginMethod:identity.loginMethod};
}
export async function snapshot(c: Awaited<ReturnType<typeof context>>, options: { includeArchive?: boolean } = {}) {
  const [room,list,photos,captions,videos]=await Promise.all([
    c.db.prepare('SELECT data,revision,updated_at FROM room_state WHERE id=1').first<{data:string,revision:number,updated_at:number}>(),
    c.db.prepare('SELECT user_id,slot,last_seen FROM members ORDER BY slot').all<{user_id:string,slot:number,last_seen:number}>(),
    c.db.prepare('SELECT p.id,p.caption,p.created_at,p.taken_at,p.latitude,p.longitude,p.location_name,p.user_id,a.description AS ai_description,a.tags AS ai_tags,a.category AS ai_category,a.updated_at AS ai_updated_at FROM photos p LEFT JOIN photo_ai a ON a.photo_id=p.id ORDER BY p.taken_at,p.id').all<{id:string,caption:string,created_at:number,taken_at:Date|string|number,latitude:number|string|null,longitude:number|string|null,location_name:string|null,user_id:string}>(),
    c.db.prepare('SELECT id,photo_id,text,created_at,author_slot FROM photo_captions ORDER BY created_at,id').all<{id:string,photo_id:string,text:string,created_at:number,author_slot:number}>(),
    c.db.prepare("SELECT id,caption,content_type,size_bytes,created_at FROM videos WHERE status='ready' ORDER BY created_at").all<{id:string,caption:string,content_type:string,size_bytes:number,created_at:number}>(),
  ]);
  if(!room)throw new HomeError('小屋正在准备，请重试。',503);
  const slots=new Map(list.results.map(m=>[m.user_id,m.slot])),byPhoto=new Map<string,typeof captions.results>();
  for(const caption of captions.results){const rows=byPhoto.get(caption.photo_id)||[];rows.push(caption);byPhoto.set(caption.photo_id,rows)}
  const publicPhotos=photos.results.map(p=>{const parsed=p.taken_at instanceof Date?p.taken_at.getTime():/^\d+$/.test(String(p.taken_at))?Number(p.taken_at):Date.parse(String(p.taken_at)),latitude=p.latitude===null?null:Number(p.latitude),longitude=p.longitude===null?null:Number(p.longitude);return{id:p.id,caption:p.caption,created_at:p.created_at,taken_at:Number.isFinite(parsed)?parsed:p.created_at,latitude:Number.isFinite(latitude)?latitude:null,longitude:Number.isFinite(longitude)?longitude:null,location_name:p.location_name||null,url:'/api/photos/'+p.id,ai:publicPhotoAI(p),captions:[...(p.caption?[{id:'original',text:p.caption,createdAt:p.created_at,authorSlot:slots.get(p.user_id)||null,original:true}]:[]),...(byPhoto.get(p.id)||[]).map(x=>({id:x.id,text:x.text,createdAt:x.created_at,authorSlot:x.author_slot,original:false}))]}});
  // 完整备份需要把不存放在 room_state 的独立表一并带进 state，前端导出才会克隆走。
  // 日常 /api/home 请求不开启，避免每次刷新都拉取全部足迹与对局记录。
  const state: Record<string, unknown> = {...publicState(JSON.parse(room.data),Date.now(),c.member.slot),photos:publicPhotos,videos:videos.results.map(v=>({id:v.id,caption:v.caption,contentType:v.content_type,sizeBytes:v.size_bytes,created_at:v.created_at}))};
  if(options.includeArchive===true)state.archive=await collectArchivedTables(c.db);
  return {syncTag:await homeSyncTag(room.revision,[...photos.results,...captions.results,...videos.results],[c.member.slot,c.canManagePasswords,c.loginMethod]),state,revision:room.revision,updatedAt:room.updated_at,me:{slot:c.member.slot,canManagePasswords:c.canManagePasswords,loginMethod:c.loginMethod,videoEnabled:!!c.videoStore},members:list.results.map(m=>({slot:m.slot,online:Date.now()-m.last_seen<60000,joined:m.last_seen>0}))};
}
