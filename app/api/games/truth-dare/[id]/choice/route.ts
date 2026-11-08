import { fail, json, requireSameOrigin } from '../../../../../../lib/home-server';
import { HomeError } from '../../../../../../lib/home-domain.mjs';
import { findGame, gameContext, publicGame, readGame, requireStatus } from '../../../../../../lib/truth-dare-games';
import { notifyTruthDareChanged } from '../../../../../../lib/truth-dare-stream';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{id: string}> };

export async function POST(req: Request, {params}: Params) {
  try {
    requireSameOrigin(req);
    const {id} = await params;
    const {c, game} = await gameContext(id);
    const input = await readGame(req);
    requireStatus(game, 'waiting_loser_choice');
    if (game.loser_id !== c.member.userId) throw new HomeError('只有输家可以选择题目类型。', 403);
    if (input.choiceType !== 'truth' && input.choiceType !== 'dare') {
      throw new HomeError('请选择真心话或大冒险。');
    }

    const updated = await c.db.prepare(`UPDATE truth_dare_games
      SET choice_type=?,status='waiting_winner_question'
      WHERE id=? AND loser_id=? AND status='waiting_loser_choice'`)
      .bind(input.choiceType, id, c.member.userId).run();
    if (!updated.meta.changes) throw new HomeError('对局状态已变化，请刷新后重试。', 409);
    notifyTruthDareChanged(c.db);
    return json({ game: publicGame(await findGame(c.db, id), c.member.userId) });
  } catch (error) { return fail(error); }
}
