import { context, json, parseObject } from './home-server';
import { HomeError } from './home-domain.mjs';

type GameRow = {
  id: string;
  creator_id: string;
  partner_id: string;
  p1_roll: number | null;
  p2_roll: number | null;
  status: string;
  loser_id: string | null;
  choice_type: string | null;
  question_text: string | null;
  created_at: number;
};

export async function readGame(req: Request) {
  if (Number(req.headers.get('content-length') || 0) > 4000) throw new HomeError('请求内容太大。', 413);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 4000) throw new HomeError('请求内容太大。', 413);
  return parseObject(raw);
}

export async function findGame(db: Awaited<ReturnType<typeof context>>['db'], id: string) {
  return db.prepare(`SELECT id,creator_id,partner_id,p1_roll,p2_roll,status,loser_id,choice_type,question_text,created_at
    FROM truth_dare_games WHERE id=?`).bind(id).first<GameRow>();
}

export function publicGame(row: GameRow | null, userId: string) {
  if (!row) return null;
  const isCreator = row.creator_id === userId;
  const isLoser = row.loser_id === userId;
  return {
    id: row.id,
    role: isCreator ? 'p1' : 'p2',
    p1Roll: row.p1_roll === null ? null : Number(row.p1_roll),
    p2Roll: row.p2_roll === null ? null : Number(row.p2_roll),
    status: row.status,
    isLoser,
    isWinner: row.loser_id !== null && !isLoser,
    choiceType: row.choice_type,
    questionText: row.question_text,
    createdAt: Number(row.created_at),
  };
}

export async function currentGame(db: Awaited<ReturnType<typeof context>>['db'], userId: string) {
  return db.prepare(`SELECT id,creator_id,partner_id,p1_roll,p2_roll,status,loser_id,choice_type,question_text,created_at
    FROM truth_dare_games
    WHERE creator_id=? OR partner_id=?
    ORDER BY CASE WHEN status <> 'finished' THEN 0 ELSE 1 END, created_at DESC, id DESC
    LIMIT 1`).bind(userId, userId).first<GameRow>();
}

export async function sendGame(row: GameRow | null, userId: string) {
  return json({ game: publicGame(row, userId) });
}

export async function gameContext(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new HomeError('对局编号无效。', 400);
  const c = await context();
  const game = await findGame(c.db, id);
  if (!game) throw new HomeError('对局不存在。', 404);
  if (game.creator_id !== c.member.userId && game.partner_id !== c.member.userId) {
    throw new HomeError('你不属于这场对局。', 403);
  }
  return { c, game };
}

export function requireStatus(game: GameRow, status: string) {
  if (game.status !== status) throw new HomeError('对局状态已变化，请刷新后重试。', 409);
}
