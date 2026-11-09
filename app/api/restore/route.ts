import {requireNativeOwner} from '../../../lib/home-auth';
import {context,json,fail,requireSameOrigin,snapshot} from '../../../lib/home-server';
import {restoreState,HomeError} from '../../../lib/home-domain.mjs';
import {validateArchive,restoreArchivedTables} from '../../../lib/backup-archive.mjs';
export const dynamic='force-dynamic';
// 完整备份现在还带有独立表数据，文字部分的上限需要放宽；附加数据另有 8MB 校验。
const MAX_BODY_BYTES=16*1024*1024;
export async function POST(req:Request){try{
 requireSameOrigin(req);await requireNativeOwner();const c=await context(),raw=await req.text();
 if(new TextEncoder().encode(raw).byteLength>MAX_BODY_BYTES)throw new HomeError('备份过大，请联系部署者使用服务器快照。',413);
 let p;try{p=JSON.parse(raw)}catch{throw new HomeError('请选择有效的 JSON 备份。')}
 if(!p||typeof p!=='object'||p.confirmation!=='恢复小屋'||!Number.isInteger(p.expectedRevision))throw new HomeError('请预览备份并确认恢复。');
 const state=restoreState(p.data,c.member,c.now),archive=validateArchive(p.data?.archive);
 // 先做带版本号的文字恢复；冲突时直接失败，绝不继续写独立表。
 const result=await c.db.prepare('UPDATE room_state SET data=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?').bind(JSON.stringify(state),c.now,p.expectedRevision).run();
 if(result.meta.changes!==1)throw new HomeError('预览后另一台设备更新了小屋，请重新预览，尚未覆盖任何内容。',409);
 // 独立表按主键合并、不删除现有记录，重复导入幂等；若这一步失败，重试恢复即可补回。
 await restoreArchivedTables(c.db,archive);
 return json(await snapshot(c));
}catch(e){return fail(e)}}
