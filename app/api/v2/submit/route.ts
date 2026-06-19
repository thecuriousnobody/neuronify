// Human verify-and-submit. This is the moment the Record of Truth begins: we
// persist the submission and open its workflow. We re-validate required fields
// server-side (never trust the client's "ready").
import { engineEnv } from '@/lib/engine';
import { submitForm, type FieldValue } from '@/engine';
import { rateLimit } from '@/lib/ratelimit';
import { resolveCity } from '@/lib/cities';
import { errorResponse } from '@/lib/engine/http';
import { currentUser } from '@/auth';
import { getSql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Beta gate: must be signed in with Google.
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Please sign in to continue.' }, { status: 401 });

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = rateLimit(ip);
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const formKey = String(body?.formKey ?? '').trim();
  if (!formKey) return Response.json({ error: 'Missing formKey.' }, { status: 400 });
  const source = body?.source === 'text' ? 'text' : 'voice';
  const values: FieldValue[] = (Array.isArray(body?.values) ? body.values : [])
    .filter((v: any) => v && typeof v.fieldKey === 'string')
    .map((v: any) => ({ fieldKey: v.fieldKey, value: v.value ?? null }));

  const env = engineEnv();
  const form = await env.repo.getFormDefinition(formKey);
  if (!form) return Response.json({ error: 'Unknown form.' }, { status: 404 });

  // Re-validate: every required NON-attachment field must be present.
  // (Attachment upload is deferred — see Phase 3 notes.)
  const have = new Set(values.filter((v) => v.value !== '' && v.value != null).map((v) => v.fieldKey));
  const missing = form.fields
    .filter((f) => f.required && f.type !== 'attachment' && !have.has(f.key))
    .map((f) => f.label);
  if (missing.length) {
    return Response.json({ error: `Still missing: ${missing.join(', ')}` }, { status: 400 });
  }

  const city = resolveCity(body?.city).db;
  try {
    const result = await submitForm(env, { formKey, city, source, values });
    // Link the (anonymous) submission to the beta tester — beta layer only.
    try {
      await getSql()`
        insert into nf_beta_submissions (submission_id, email)
        values (${result.submissionId}, ${user.email})
        on conflict (submission_id) do nothing
      `;
    } catch (err) {
      console.error('[beta] submission link failed:', err);
    }
    return Response.json(result); // { submissionId, instanceId }
  } catch (err) {
    return errorResponse(err);
  }
}
