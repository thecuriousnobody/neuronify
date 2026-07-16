import { engineEnv } from '@/lib/engine';
import { deskAllCases } from '@/engine';
import { currentDepartment } from '@/lib/desk-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Every case in the city, any status — backs the Desk "All cases" tab. Any
// signed-in department may view the full city list (read-only); the per-case
// detail screen still gates who can ACT. Fixes the queue's blind spot where
// resolved / other-department cases disappear from view.
export async function GET() {
  const department = currentDepartment();
  if (!department) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const cases = await deskAllCases(engineEnv());
  return Response.json({ department, cases });
}
