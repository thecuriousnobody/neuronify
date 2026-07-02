// The staff confirm gate: an accountable human launches the composed workflow.
// Takes the (possibly staff-edited) values + graph and opens the workflow via
// submitGraph — which FREEZES the graph into the audit log and re-validates it
// server-side (compileGraph throws on anything malformed, before any write).
//
// City is taken from the authoritative form definition, never trusted from the
// client. Gated to signed-in staff.

import { engineEnv } from '@/lib/engine';
import { submitGraph } from '@/engine';
import type { WorkflowGraph, FieldValue } from '@/engine';
import { currentDepartment } from '@/lib/desk-auth';
import { deletePending } from '@/lib/pending';
import { rateLimit } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/engine/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const staff = currentDepartment();
  if (!staff) return Response.json({ error: 'Staff sign-in required.' }, { status: 401 });

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
  const graph = body?.graph as WorkflowGraph | undefined;
  const source = body?.source === 'text' ? 'text' : 'voice';
  const pendingId = typeof body?.pendingId === 'string' ? body.pendingId : null;
  if (!formKey) return Response.json({ error: 'Missing formKey.' }, { status: 400 });
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return Response.json({ error: 'Missing or malformed graph.' }, { status: 400 });

  const values: FieldValue[] = (Array.isArray(body?.values) ? body.values : [])
    .filter((v: any) => v && typeof v.fieldKey === 'string')
    .map((v: any) => ({ fieldKey: v.fieldKey, value: v.value ?? null }));

  const env = engineEnv();
  const form = await env.repo.getFormDefinition(formKey);
  if (!form) return Response.json({ error: 'Unknown form.' }, { status: 404 });

  try {
    const { submissionId } = await submitGraph(env, {
      formKey: form.key,
      formVersion: form.version,
      city: form.city, // authoritative — never from the client
      source,
      values,
      graph,
    });
    // Promoted to a submission — clear it from the pending queue (best-effort).
    if (pendingId) await deletePending(pendingId).catch(() => {});
    return Response.json({ submissionId });
  } catch (err) {
    return errorResponse(err);
  }
}
