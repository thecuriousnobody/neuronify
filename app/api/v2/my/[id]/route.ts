// Owner-only detail for a submission: enough for the citizen to see status and,
// if a department bounced something, exactly which fields to fix + why.
import { engineEnv } from '@/lib/engine';
import { getInstanceView } from '@/engine';
import { currentUser } from '@/auth';
import { ownsSubmission } from '@/lib/beta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  // Don't reveal existence to non-owners.
  if (!(await ownsSubmission(user.email, params.id))) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const env = engineEnv();
  const view = await getInstanceView(env, params.id);
  if (!view) return Response.json({ error: 'Not found.' }, { status: 404 });

  const form = await env.repo.getFormDefinition(view.submission.formKey, view.submission.formVersion);
  const openStep = view.instance.steps.find((s) => s.status === 'open');
  const bounced = openStep?.approvals.filter((a) => a.status === 'awaiting_resubmit') ?? [];
  const requestedFields = [...new Set(bounced.flatMap((a) => a.resubmitScope ?? []))];

  return Response.json({
    submissionId: params.id,
    formKey: view.submission.formKey,
    status: view.instance.status,
    values: view.submission.values,
    fields: form?.fields ?? [],
    needsInput: bounced.length > 0,
    requestedFields,
    notes: bounced
      .map((a) => ({ approver: a.approver, reason: a.reason }))
      .filter((b) => b.reason),
    timing: { internalMs: view.timing.internalMs, externalMs: view.timing.externalMs },
  });
}
