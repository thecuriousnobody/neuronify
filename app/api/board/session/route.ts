import { getSql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns the most recent board session, or creates one if none exist.
export async function GET() {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, name FROM sessions ORDER BY created_at DESC LIMIT 1
  `) as { id: string; name: string }[];
  if (rows.length > 0) return Response.json(rows[0]);

  const created = (await sql`
    INSERT INTO sessions (name) VALUES ('Untitled session') RETURNING id, name
  `) as { id: string; name: string }[];
  return Response.json(created[0]);
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const { id, name } = body;
  if (!id || !name?.trim()) {
    return Response.json({ error: 'id and name required' }, { status: 400 });
  }
  const sql = getSql();
  const rows = (await sql`
    UPDATE sessions SET name = ${name.trim()} WHERE id = ${id} RETURNING id, name
  `) as { id: string; name: string }[];
  if (!rows.length) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(rows[0]);
}
