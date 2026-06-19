// The signed-in tester's own submissions + whether any need their input.
import { engineEnv } from '@/lib/engine';
import { getInstanceView } from '@/engine';
import { currentUser } from '@/auth';
import { listMySubmissionIds } from '@/lib/beta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const env = engineEnv();
  const ids = await listMySubmissionIds(user.email);
  const items = [];
  for (const id of ids) {
    const view = await getInstanceView(env, id);
    if (!view) continue;
    const openStep = view.instance.steps.find((s) => s.status === 'open');
    const needsInput = !!openStep?.approvals.some((a) => a.status === 'awaiting_resubmit');
    items.push({
      submissionId: id,
      formKey: view.submission.formKey,
      submittedAt: view.submission.submittedAt,
      status: view.instance.status,
      needsInput,
    });
  }
  return Response.json({ items });
}
