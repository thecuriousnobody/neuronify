import { getSql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Single call that returns all clusters + ideas for a session.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id');
  if (!sessionId) return Response.json({ error: 'session_id required' }, { status: 400 });

  const sql = getSql();
  const [clusters, ideas] = await Promise.all([
    sql`SELECT * FROM clusters WHERE session_id = ${sessionId} ORDER BY sort_order, created_at`,
    sql`SELECT * FROM ideas WHERE session_id = ${sessionId} ORDER BY created_at`,
  ]);

  return Response.json({ clusters, ideas });
}
