import { fail, json, requireSameOrigin } from '../../../../../../lib/home-server';
import { HomeError } from '../../../../../../lib/home-domain.mjs';
import { findGame, gameContext, publicGame, readGame, requireStatus } from '../../../../../../lib/truth-dare-games';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{id: string}> };

export async function POST(req: Request, {params}: Params) {
  try {
    requireSameOrigin(req);
    const {id} = await params;
    const {c, game} = await gameContext(id);
    const input = await readGame(req);
    requireStatus(game, 'waiting_winner_question');
    const winnerId = game.loser_id === game.creator_id ? game.partner_id : game.creator_id;
    if (!game.loser_id || winnerId !== c.member.userId) {
      throw new HomeError('只有赢家可以提交题目。', 403);
    }
    if (typeof input.questionText !== 'string' || input.questionText.length > 300 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.questionText)) {
      throw new HomeError('题目无效，最多 300 个字符。');
    }
    const questionText = input.questionText.trim();
    if (!questionText) throw new HomeError('请填写或选择一道题目。');

    const updated = await c.db.prepare(`UPDATE truth_dare_games
      SET question_text=?,status='waiting_loser_answer'
      WHERE id=? AND status='waiting_winner_question' AND loser_id=?`)
      .bind(questionText, id, game.loser_id).run();
    if (!updated.meta.changes) throw new HomeError('对局状态已变化，请刷新后重试。', 409);
    return json({ game: publicGame(await findGame(c.db, id), c.member.userId) });
  } catch (error) { return fail(error); }
}
