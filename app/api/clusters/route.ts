import { getSql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PALETTE = ['--c1', '--c2', '--c3', '--c4', '--c5'];

export async function POST(req: Request) {
  const body = await req.json();
  const { session_id, name } = body;
  if (!session_id || !name) {
    return Response.json({ error: 'session_id and name required' }, { status: 400 });
  }

  const sql = getSql();
  // Count existing clusters to assign the next palette color.
  const count = (await sql`
    SELECT COUNT(*)::int AS count FROM clusters WHERE session_id = ${session_id}
  `) as { count: string }[];
  const idx = Number(count[0]?.count ?? 0);
  const color = PALETTE[idx % PALETTE.length];

  const rows = await sql`
    INSERT INTO clusters (session_id, name, color, sort_order)
    VALUES (${session_id}, ${name}, ${color}, ${idx})
    RETURNING *
  `;
  return Response.json(rows[0]);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const sql = getSql();
  // Delete ideas in the lane first (ON DELETE SET NULL would leave them invisible).
  await sql`DELETE FROM ideas WHERE cluster_id = ${id}`;
  await sql`DELETE FROM clusters WHERE id = ${id}`;
  return Response.json({ ok: true });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const { id, name } = body;
  if (!id || !name) {
    return Response.json({ error: 'id and name required' }, { status: 400 });
  }

  const sql = getSql();
  const rows = await sql`
    UPDATE clusters SET name = ${name} WHERE id = ${id} RETURNING *
  `;
  if (rows.length === 0) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(rows[0]);
}
