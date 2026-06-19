import { engineEnv } from '@/lib/engine';
import { deskSubmissionDetail } from '@/engine';
import { currentDepartment } from '@/lib/desk-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const department = currentDepartment();
  if (!department) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const detail = await deskSubmissionDetail(engineEnv(), department, params.id);
  if (!detail) return Response.json({ error: 'Not found.' }, { status: 404 });
  return Response.json({ department, ...detail });
}
