// Staff-side digestion: a transcript in, a PROPOSAL out — filled form values,
// classification (category/severity/department), and a composed workflow graph.
// Launches nothing; the staff confirm gate (/api/v2/confirm) is the human that
// actually opens the workflow. Gated to signed-in staff; the department
// allow-list is the real set of desk departments.

import { engineEnv } from '@/lib/engine';
import { digestDrop, composeGraph } from '@/engine';
import { currentDepartment, departments } from '@/lib/desk-auth';
import { rateLimit } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/engine/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TRANSCRIPT = 8000;
// Fallback routing targets if DESK_PASSCODES isn't configured with real depts.
const DEFAULT_DEPARTMENTS = ['public_works', 'water', 'parks', 'code_enforcement'];

export async function POST(req: Request) {
  // Any signed-in staff member may run the intake console.
  if (!currentDepartment()) return Response.json({ error: 'Staff sign-in required.' }, { status: 401 });

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
  const transcript = String(body?.transcript ?? '').trim();
  if (!formKey) return Response.json({ error: 'Missing formKey.' }, { status: 400 });
  if (!transcript) return Response.json({ error: 'Nothing to digest — transcript is empty.' }, { status: 400 });
  if (transcript.length > MAX_TRANSCRIPT)
    return Response.json({ error: `Transcript too long (max ${MAX_TRANSCRIPT}).` }, { status: 400 });

  const env = engineEnv();
  const form = await env.repo.getFormDefinition(formKey);
  if (!form) return Response.json({ error: 'Unknown form.' }, { status: 404 });

  // Route among the real desk departments (drop the intake 'clerk' role); fall
  // back to a Peoria default so the demo works before passcodes are configured.
  const deptList = departments().filter((d) => d !== 'clerk');
  const routable = deptList.length ? deptList : DEFAULT_DEPARTMENTS;

  try {
    const digest = await digestDrop(env.llm, form, transcript, { departments: routable });
    const graph = composeGraph(digest.classification, {
      formKey: form.key,
      // The department signs off on every field the resident actually gave.
      scope: digest.values.map((v) => v.fieldKey),
    });
    return Response.json({
      form: { key: form.key, title: form.title, city: form.city, fields: form.fields },
      values: digest.values,
      missing: digest.missing,
      classification: digest.classification,
      graph,
      routableDepartments: routable,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
