import { engineEnv } from '@/lib/engine';
import { deskReassign } from '@/engine';
import { currentDepartment } from '@/lib/desk-auth';
import { rateLimit } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/engine/http';
import { drainOutbox } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Reassign the current step to another department, with a mandatory reason.
// The signed-in department (the current owner) is forced from the verified
// cookie — never the body. An optional `category` relabels the case type.
export async function POST(req: Request) {
  const department = currentDepartment();
  if (!department) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const lim = rateLimit('desk-act:' + ip);
  if (!lim.ok) return Response.json({ error: lim.reason }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const submissionId = String(body?.submissionId ?? '');
  const toApprover = String(body?.toApprover ?? '').trim();
  const reason = String(body?.reason ?? '').trim();
  const category = body?.category ? String(body.category).trim() : undefined;

  if (!submissionId) return Response.json({ error: 'Missing submissionId.' }, { status: 400 });
  if (!toApprover) return Response.json({ error: 'Pick a department to reassign to.' }, { status: 400 });
  if (!reason) return Response.json({ error: 'A reason for the reassignment is required.' }, { status: 400 });

  try {
    await deskReassign(engineEnv(), department, { submissionId, toApprover, reason, category });
    await drainOutbox(submissionId).catch(() => {}); // deliver the relay, best-effort
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
