import { generateBrief } from '@/lib/brief';
import { getOrCreateSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body — fall back to current session */
  }

  let sessionId = body?.sessionId as string | undefined;
  if (!sessionId) sessionId = (await getOrCreateSession()).id;

  try {
    const brief = await generateBrief(sessionId);
    return Response.json(brief);
  } catch (err: any) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
