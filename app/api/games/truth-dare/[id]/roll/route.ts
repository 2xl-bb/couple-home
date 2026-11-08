import { fail, json, requireSameOrigin } from '../../../../../../lib/home-server';
import { HomeError } from '../../../../../../lib/home-domain.mjs';
import { findGame, gameContext, publicGame, readGame } from '../../../../../../lib/truth-dare-games';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{id: string}> };

export async function POST(req: Request, {params}: Params) {
  try {
    requireSameOrigin(req);
    const {id} = await params;
    const {c, game} = await gameContext(id);
    const input = await readGame(req);
    if (!Number.isInteger(input.roll) || input.roll < 1 || input.roll > 6) {
      throw new HomeError('骰子点数必须是 1 到 6 的整数。');
    }

    let updated;
    if (game.status === 'waiting_p1_roll') {
      if (game.creator_id !== c.member.userId) throw new HomeError('现在轮到发起人掷骰子。', 403);
      updated = await c.db.prepare(`UPDATE truth_dare_games
        SET p1_roll=?,p2_roll=NULL,loser_id=NULL,choice_type=NULL,question_text=NULL,status='waiting_p2_roll'
        WHERE id=? AND creator_id=? AND status='waiting_p1_roll'`)
        .bind(input.roll, id, c.member.userId).run();
    } else if (game.status === 'waiting_p2_roll') {
      if (game.partner_id !== c.member.userId) throw new HomeError('现在轮到另一位成员掷骰子。', 403);
      updated = await c.db.prepare(`UPDATE truth_dare_games
        SET p2_roll=?,
          status=CASE WHEN p1_roll=? THEN 'waiting_p1_roll' ELSE 'waiting_loser_choice' END,
          loser_id=CASE WHEN p1_roll=? THEN NULL WHEN p1_roll<? THEN creator_id ELSE partner_id END
        WHERE id=? AND partner_id=? AND status='waiting_p2_roll' AND p2_roll IS NULL`)
        .bind(input.roll, input.roll, input.roll, input.roll, id, c.member.userId).run();
    } else {
      throw new HomeError('当前阶段不能掷骰子。', 409);
    }
    if (!updated.meta.changes) throw new HomeError('对局状态已变化，请刷新后重试。', 409);
    const row = await findGame(c.db, id);
    return json({ game: publicGame(row, c.member.userId) });
  } catch (error) { return fail(error); }
}
