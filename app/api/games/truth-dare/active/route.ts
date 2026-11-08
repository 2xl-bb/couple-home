import { context, fail, json } from '../../../../../lib/home-server';
import { currentGame, publicGame } from '../../../../../lib/truth-dare-games';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const c = await context();
    return json({ game: publicGame(await currentGame(c.db, c.member.userId), c.member.userId) });
  } catch (error) { return fail(error); }
}
