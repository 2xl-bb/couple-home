import { context, fail, json, requireSameOrigin } from '../../../../../../lib/home-server';
import { HomeError } from '../../../../../../lib/home-domain.mjs';
import { readGame } from '../../../../../../lib/truth-dare-games';
import type { TodoRow } from '../route';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{id: string}> };

export async function PATCH(req: Request, {params}: Params) {
  try {
    requireSameOrigin(req);
    const {id} = await params;
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new HomeError('待办编号无效。');
    const c = await context();
    const input = await readGame(req);
    if (input.completed !== true) throw new HomeError('完成状态无效。');
    await c.db.prepare(`UPDATE truth_dare_games SET todo_completed_at=?
      WHERE id=? AND todo_created_at IS NOT NULL AND todo_completed_at IS NULL`).bind(c.now, id).run();
    const todo = await c.db.prepare(`SELECT id,question_text,todo_created_at,todo_completed_at
      FROM truth_dare_games WHERE id=? AND todo_created_at IS NOT NULL`).bind(id).first<TodoRow>();
    if (!todo) throw new HomeError('待办不存在。', 404);
    return json({todo: {
      id: todo.id,
      gameId: todo.id,
      text: todo.question_text,
      createdAt: Number(todo.todo_created_at),
      completedAt: todo.todo_completed_at === null ? null : Number(todo.todo_completed_at),
    }});
  } catch (error) { return fail(error); }
}
