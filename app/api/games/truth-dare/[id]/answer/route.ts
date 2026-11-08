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
    requireStatus(game, 'waiting_loser_answer');
    if (!game.loser_id || game.loser_id !== c.member.userId) {
      throw new HomeError('只有输家可以提交回答。', 403);
    }
    if (typeof input.answerText !== 'string' || input.answerText.length > 1000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.answerText)) {
      throw new HomeError('回答无效，最多 1000 个字符。');
    }
    const answerText = input.answerText.trim();
    if (!answerText) throw new HomeError('请填写回答。');

    const updated = await c.db.prepare(`UPDATE truth_dare_games
      SET answer_text=?,status='finished'
      WHERE id=? AND status='waiting_loser_answer' AND loser_id=?`)
      .bind(answerText, id, c.member.userId).run();
    if (!updated.meta.changes) throw new HomeError('对局状态已变化，请刷新后重试。', 409);
    return json({ game: publicGame(await findGame(c.db, id), c.member.userId) });
  } catch (error) { return fail(error); }
}
