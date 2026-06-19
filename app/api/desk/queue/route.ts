import { engineEnv } from '@/lib/engine';
import { deskQueue } from '@/engine';
import { currentDepartment } from '@/lib/desk-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const department = currentDepartment();
  if (!department) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const items = await deskQueue(engineEnv(), department);
  return Response.json({ department, items });
}
