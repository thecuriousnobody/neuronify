// Staff-side: the review queue of pending resident drops (GET), and dismiss (POST
// with {id, action:'dismiss'}). Promotion to a submission happens via /confirm,
// which clears the pending itself. Staff-gated.

import { listPending, deletePending, getPending } from '@/lib/pending';
import { currentDepartment } from '@/lib/desk-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!currentDepartment()) return Response.json({ error: 'Staff sign-in required.' }, { status: 401 });
  const items = await listPending();
  return Response.json({ items });
}

export async function POST(req: Request) {
  if (!currentDepartment()) return Response.json({ error: 'Staff sign-in required.' }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const id = String(body?.id ?? '').trim();
  if (!id) return Response.json({ error: 'Missing id.' }, { status: 400 });
  if (body?.action === 'dismiss') {
    const p = await getPending(id);
    if (!p) return Response.json({ error: 'Not found.' }, { status: 404 });
    await deletePending(id);
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'Unknown action.' }, { status: 400 });
}
