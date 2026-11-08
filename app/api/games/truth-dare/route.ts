import { context, fail, json, requireSameOrigin } from '../../../../lib/home-server';
import { HomeError } from '../../../../lib/home-domain.mjs';
import { currentGame, publicGame, readGame } from '../../../../lib/truth-dare-games';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const c = await context();
    return json({ game: publicGame(await currentGame(c.db, c.member.userId), c.member.userId) });
  } catch (error) { return fail(error); }
}

export async function POST(req: Request) {
  try {
    requireSameOrigin(req);
    const c = await context();
    await readGame(req);
    const partner = await c.db.prepare('SELECT user_id FROM members WHERE slot=?')
      .bind(c.member.slot === 1 ? 2 : 1).first<{user_id: string}>();
    if (!partner) throw new HomeError('另一位成员尚未加入小屋。', 409);

    const id = crypto.randomUUID();
    const result = await c.db.prepare(`INSERT OR IGNORE INTO truth_dare_games
      (id,creator_id,partner_id,status,created_at)
      SELECT ?,?,?, 'waiting_p1_roll',?
      WHERE NOT EXISTS (SELECT 1 FROM truth_dare_games WHERE status <> 'finished')`)
      .bind(id, c.member.userId, partner.user_id, c.now).run();
    if (!result.meta.changes) {
      const active = await c.db.prepare(`SELECT id,creator_id,partner_id,p1_roll,p2_roll,status,loser_id,choice_type,question_text,created_at
        FROM truth_dare_games WHERE status <> 'finished' ORDER BY created_at DESC,id DESC LIMIT 1`)
        .first();
      if (!active) throw new HomeError('暂时无法创建对局，请重试。', 409);
      return json({ game: publicGame(active, c.member.userId), existed: true });
    }

    const game = await c.db.prepare(`SELECT id,creator_id,partner_id,p1_roll,p2_roll,status,loser_id,choice_type,question_text,created_at
      FROM truth_dare_games WHERE id=?`).bind(id).first();
    return json({ game: publicGame(game, c.member.userId), existed: false }, 201);
  } catch (error) { return fail(error); }
}
