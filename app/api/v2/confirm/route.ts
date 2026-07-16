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
import { deletePending, getPending } from '@/lib/pending';
import { drainOutbox } from '@/lib/notify';
import { getSql } from '@/lib/db';
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
    // Grab the pending drop BEFORE launch — it may carry the resident's SMS opt-in.
    const pending = pendingId ? await getPending(pendingId).catch(() => null) : null;

    const { submissionId, submittedAt } = await submitGraph(env, {
      formKey: form.key,
      formVersion: form.version,
      city: form.city, // authoritative — never from the client
      source,
      values,
      graph,
      launchedBy: staff, // the accountable human, recorded in the frozen ledger
      transcript: pending?.transcript, // preserve the resident's original words into the ledger
    });

    // Carry the opt-in phone over (separate from the anonymous Record of Truth).
    if (pending?.phone) {
      try {
        const sql = getSql();
        await sql`
          insert into nf_submission_contacts (submission_id, phone)
          values (${submissionId}, ${pending.phone})
          on conflict (submission_id) do nothing
        `;
      } catch {
        /* contact is best-effort — never blocks the launch */
      }
    }

    // Promoted to a submission — clear it from the pending queue (best-effort).
    if (pendingId) await deletePending(pendingId).catch(() => {});

    // Deliver the receipt SMS + department nudges (best-effort, never blocks the launch).
    await drainOutbox(submissionId).catch(() => {});

    return Response.json({ submissionId, submittedAt, launchedBy: staff });
  } catch (err) {
    return errorResponse(err);
  }
}
