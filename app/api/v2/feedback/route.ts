// Staff thumbs on the agent's work. Persisted with the proposal context so the
// verdicts are a real tuning signal, not vibes. Staff-gated. Lesson from the v1
// feedback API burn: accept exactly what the UI sends ('up' | 'down').

import { getSql } from '@/lib/db';
import { currentDepartment } from '@/lib/desk-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTEXT = 16 * 1024; // context snapshot cap

export async function POST(req: Request) {
  const dept = currentDepartment();
  if (!dept) return Response.json({ error: 'Staff sign-in required.' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const surface = String(body?.surface ?? '').trim();
  const verdict = body?.verdict === 'up' ? 'up' : body?.verdict === 'down' ? 'down' : null;
  if (!surface) return Response.json({ error: 'Missing surface.' }, { status: 400 });
  if (!verdict) return Response.json({ error: 'Verdict must be "up" or "down".' }, { status: 400 });

  const context = JSON.stringify(body?.context ?? {});
  if (context.length > MAX_CONTEXT)
    return Response.json({ error: 'Context too large.' }, { status: 413 });

  const sql = getSql();
  await sql`
    insert into nf_agent_feedback (surface, verdict, department, context)
    values (${surface}, ${verdict}, ${dept}, ${context})
  `;
  return Response.json({ ok: true });
}
