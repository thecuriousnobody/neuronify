import { getSql } from '@/lib/db';
import { getOrCreateSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Polled by /wall (~1.2s). Returns triaged summaries only — never raw_text.
export async function GET(req: Request) {
  const url = new URL(req.url);
  let sessionId = url.searchParams.get('sessionId') || undefined;
  if (!sessionId) sessionId = (await getOrCreateSession()).id;

  const sql = getSql();
  const submissions = await sql`
    select id, created_at, source, status, summary, category, severity,
           cost_low_usd, cost_high_usd
    from submissions
    where session_id = ${sessionId}
    order by created_at asc
  `;

  return Response.json(
    { sessionId, count: submissions.length, submissions },
    { headers: { 'cache-control': 'no-store' } },
  );
}
