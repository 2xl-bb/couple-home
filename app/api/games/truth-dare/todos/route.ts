import { context, fail, json, requireSameOrigin } from '../../../../../lib/home-server';
import { HomeError } from '../../../../../lib/home-domain.mjs';
import { gameContext, readGame } from '../../../../../lib/truth-dare-games';

export type TodoRow = {
  id: string;
  question_text: string;
  todo_created_at: number;
  todo_completed_at: number | null;
};

const publicTodo = (todo: TodoRow) => ({
  id: todo.id,
  gameId: todo.id,
  text: todo.question_text,
  createdAt: Number(todo.todo_created_at),
  completedAt: todo.todo_completed_at === null ? null : Number(todo.todo_completed_at),
});

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const c = await context();
    const todos = await c.db.prepare(`SELECT id,question_text,todo_created_at,todo_completed_at
      FROM truth_dare_games WHERE todo_created_at IS NOT NULL
      ORDER BY todo_completed_at IS NOT NULL, todo_created_at DESC LIMIT 200`)
      .all<TodoRow>();
    return json({ todos: todos.results.map(publicTodo) });
  } catch (error) { return fail(error); }
}

export async function POST(req: Request) {
  try {
    requireSameOrigin(req);
    const input = await readGame(req);
    if (typeof input.gameId !== 'string') throw new HomeError('对局编号无效。');
    const {c, game} = await gameContext(input.gameId);
    if (game.choice_type !== 'dare' || !game.question_text ||
        !['waiting_loser_answer', 'finished'].includes(game.status)) {
      throw new HomeError('只有已出题的大冒险可以存入待办。', 409);
    }

    await c.db.prepare(`UPDATE truth_dare_games SET todo_created_at=?
      WHERE id=? AND todo_created_at IS NULL`).bind(c.now, game.id).run();
    const todo = await c.db.prepare(`SELECT id,question_text,todo_created_at,todo_completed_at
      FROM truth_dare_games WHERE id=? AND todo_created_at IS NOT NULL`).bind(game.id).first<TodoRow>();
    if (!todo) throw new HomeError('保存待办失败，请重试。', 500);
    return json({ todo: publicTodo(todo) }, 201);
  } catch (error) { return fail(error); }
}
