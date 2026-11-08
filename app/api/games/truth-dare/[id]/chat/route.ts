import { fail, json, requireSameOrigin } from '../../../../../../lib/home-server';
import { HomeError } from '../../../../../../lib/home-domain.mjs';
import {
  findGame, gameContext, MAX_CHAT_MESSAGES, parseChatMessages, publicGame, readGame,
} from '../../../../../../lib/truth-dare-games';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{id: string}> };

export async function POST(req: Request, {params}: Params) {
  try {
    requireSameOrigin(req);
    const {id} = await params;
    const {c, game} = await gameContext(id);
    const input = await readGame(req);
    if (typeof input.messageId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.messageId)) {
      throw new HomeError('消息编号无效。');
    }
    if (typeof input.text !== 'string' || input.text.length > 500 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text)) {
      throw new HomeError('消息无效，最多 500 个字符。');
    }
    const text = input.text.trim();
    if (!text) throw new HomeError('请先写下消息。');

    for (let attempt = 0; attempt < 5; attempt++) {
      const current = attempt === 0 ? game : await findGame(c.db, id);
      if (!current) throw new HomeError('对局不存在。', 404);
      const messages = parseChatMessages(current.chat_messages);
      const duplicate = messages.find(message => message.id === input.messageId);
      if (duplicate) {
        if (duplicate.sender_id !== c.member.userId || duplicate.text !== text) {
          throw new HomeError('消息编号已被使用。', 409);
        }
        return json({game: publicGame(current, c.member.userId), existed: true});
      }

      const next = [...messages, {
        id: input.messageId,
        sender_id: c.member.userId,
        text,
        timestamp: c.now,
      }].slice(-MAX_CHAT_MESSAGES);
      const updated = await c.db.prepare(`UPDATE truth_dare_games SET chat_messages=?
        WHERE id=? AND chat_messages=?`).bind(JSON.stringify(next), id, current.chat_messages).run();
      if (updated.meta.changes) {
        return json({game: publicGame(await findGame(c.db, id), c.member.userId), existed: false}, 201);
      }
    }
    throw new HomeError('消息发送冲突，请稍后重试。', 409);
  } catch (error) { return fail(error); }
}
