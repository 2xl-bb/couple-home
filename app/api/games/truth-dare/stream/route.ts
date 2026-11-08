import { context, fail } from '../../../../../lib/home-server';
import { truthDareEventStream } from '../../../../../lib/truth-dare-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const c = await context();
    return truthDareEventStream(c.db, c.member.userId);
  } catch (error) { return fail(error); }
}
