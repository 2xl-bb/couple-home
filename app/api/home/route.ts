import { context, snapshot, json, fail, requireSameOrigin, parseObject } from '../../../lib/home-server';
import { HomeError } from '../../../lib/home-domain.mjs';
import { applyStoredOperation } from '../../../lib/home-repository.mjs';
import { validateArchive, restoreArchivedTables } from '../../../lib/backup-archive.mjs';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
  const view=await snapshot(await context());
  if(new URL(req.url).searchParams.get('since')===view.syncTag){const {state,...meta}=view;return json({...meta,unchanged:true})}
  return json(view);
}catch(e){return fail(e)}}
export async function POST(req:Request){
  try{
    requireSameOrigin(req);const c=await context();
    const raw=await req.text(),op=parseObject(raw);
    // 导入完整备份会附带独立表数据，放宽上限；其余操作仍限制在 2MB。
    const limit=op.kind==='import'?16*1024*1024:2*1024*1024;
    if(new TextEncoder().encode(raw).byteLength>limit)throw new HomeError('内容太大，请分批导入。',413);
    if(typeof op.id!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(op.id))throw new HomeError('操作编号无效。');
    const photoIds=op.kind==='idea.done'?(await c.db.prepare('SELECT id FROM photos').all<{id:string}>()).results.map(p=>p.id):[];
    await applyStoredOperation(c.db,op,{...c.member,photoIds,canManageSharedImport:c.canManagePasswords},c.now);
    // 合并模式同样要带回足迹与对局；按主键合并、幂等，失败后可重试。
    if(op.kind==='import'&&op.payload?.data?.archive){
      await restoreArchivedTables(c.db,validateArchive(op.payload.data.archive));
    }
    return json(await snapshot(c));
  }catch(e){return fail(e)}
}
