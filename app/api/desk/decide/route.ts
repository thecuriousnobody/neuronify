import { engineEnv } from '@/lib/engine';
import { deskDecide } from '@/engine';
import { currentDepartment } from '@/lib/desk-auth';
import { rateLimit } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/engine/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const decision = body?.decision;
  if (!submissionId) return Response.json({ error: 'Missing submissionId.' }, { status: 400 });
  if (decision !== 'approved' && decision !== 'denied' && decision !== 'requires_resubmit') {
    return Response.json({ error: 'Invalid decision.' }, { status: 400 });
  }

  const reason = body?.reason ? String(body.reason) : undefined;
  const resubmitScope = Array.isArray(body?.resubmitScope)
    ? body.resubmitScope.map((s: any) => String(s))
    : undefined;

  try {
    // `department` comes from the verified cookie — never from the body.
    await deskDecide(engineEnv(), department, { submissionId, decision, reason, resubmitScope });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
