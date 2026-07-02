// Resident-facing digestion preview — the "here's what we understood" moment.
// Same pipeline as the staff /digest, but returns only the resident-appropriate
// view (extracted fields + what's missing + category/severity, plus the routed
// department as a nice touch). No workflow graph — that's the staff surface.
// Anonymous + rate-limited, like the rest of the resident door.

import { engineEnv } from '@/lib/engine';
import { digestDrop } from '@/engine';
import { departments } from '@/lib/desk-auth';
import { rateLimit } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/engine/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TRANSCRIPT = 8000;
const DEFAULT_FORM = 'pothole_report';
const DEFAULT_DEPARTMENTS = ['public_works', 'water', 'parks', 'code_enforcement'];

export async function POST(req: Request) {
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

  const transcript = String(body?.transcript ?? '').trim();
  if (!transcript) return Response.json({ error: 'Nothing to read yet.' }, { status: 400 });
  if (transcript.length > MAX_TRANSCRIPT)
    return Response.json({ error: `Keep it under ${MAX_TRANSCRIPT} characters.` }, { status: 400 });

  const formKey = String(body?.formKey ?? DEFAULT_FORM).trim() || DEFAULT_FORM;

  const env = engineEnv();
  const form = await env.repo.getFormDefinition(formKey);
  if (!form) return Response.json({ error: 'Unknown form.' }, { status: 404 });

  const deptList = departments().filter((d) => d !== 'clerk');
  const routable = deptList.length ? deptList : DEFAULT_DEPARTMENTS;

  try {
    const digest = await digestDrop(env.llm, form, transcript, { departments: routable });
    // Resident-appropriate view: label each form field with its value or "missing".
    const understood = form.fields
      .filter((f) => f.type !== 'attachment')
      .map((f) => ({
        key: f.key,
        label: f.label,
        value: digest.values.find((v) => v.fieldKey === f.key)?.value ?? null,
        missing: digest.missing.includes(f.key),
      }));
    return Response.json({
      understood,
      category: digest.classification.category,
      severity: digest.classification.severity,
      department: digest.classification.department,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
