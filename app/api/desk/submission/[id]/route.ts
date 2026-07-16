import { engineEnv } from '@/lib/engine';
import { deskSubmissionDetail } from '@/engine';
import { currentDepartment, departments } from '@/lib/desk-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const department = currentDepartment();
  if (!department) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const detail = await deskSubmissionDetail(engineEnv(), department, params.id);
  if (!detail) return Response.json({ error: 'Not found.' }, { status: 404 });

  // Departments this case could be reassigned to: configured departments minus
  // those already reviewing the current step (can't hand off to yourself or a
  // department already on the step).
  const onCurrentStep = new Set(
    detail.steps.find((s) => s.key === detail.currentStepKey)?.approvals.map((a) => a.approver) ?? [],
  );
  const reassignTargets = departments().filter((d) => !onCurrentStep.has(d));

  return Response.json({ department, ...detail, reassignTargets });
}
