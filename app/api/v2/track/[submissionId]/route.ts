// Citizen-facing tracking read model: current status of each step/box + the
// external/internal timing derived from the audit log. No internal notes leak.
import { engineEnv } from '@/lib/engine';
import { getInstanceView } from '@/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { submissionId: string } }) {
  const view = await getInstanceView(engineEnv(), params.submissionId);
  if (!view) return Response.json({ error: 'Not found.' }, { status: 404 });

  return Response.json({
    submissionId: view.submission.id,
    formKey: view.submission.formKey,
    city: view.submission.city,
    submittedAt: view.submission.submittedAt,
    status: view.instance.status,
    steps: view.instance.steps.map((s) => ({
      key: s.stepKey,
      status: s.status,
      approvals: s.approvals.map((a) => ({ approver: a.approver, status: a.status })),
    })),
    timing: { internalMs: view.timing.internalMs, externalMs: view.timing.externalMs },
  });
}
