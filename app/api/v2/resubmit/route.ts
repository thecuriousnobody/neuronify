// Citizen edits the bounced fields and resubmits. Ownership enforced from the
// verified session; the engine validates the edits are within the requested scope.
import { drainOutbox } from '@/lib/notify';
import { engineEnv } from '@/lib/engine';
import { recordRevisionAndResubmit, type FieldValue } from '@/engine';
import { currentUser } from '@/auth';
import { ownsSubmission } from '@/lib/beta';
import { rateLimit } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/engine/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const lim = rateLimit('resubmit:' + ip);
  if (!lim.ok) return Response.json({ error: lim.reason }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const submissionId = String(body?.submissionId ?? '');
  if (!submissionId) return Response.json({ error: 'Missing submissionId.' }, { status: 400 });
  if (!(await ownsSubmission(user.email, submissionId))) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const values: FieldValue[] = (Array.isArray(body?.values) ? body.values : [])
    .filter((v: any) => v && typeof v.fieldKey === 'string')
    .map((v: any) => ({ fieldKey: v.fieldKey, value: v.value ?? null }));

  try {
    await recordRevisionAndResubmit(engineEnv(), submissionId, values);
    await drainOutbox(submissionId).catch(() => {}); // deliver relays, best-effort
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
