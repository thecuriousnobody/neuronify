import { getSql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PALETTE = ['--c1', '--c2', '--c3', '--c4', '--c5'];

// Resolve a lane name to a cluster_id, creating the cluster if it doesn't exist.
async function resolveCluster(
  sql: ReturnType<typeof getSql>,
  sessionId: string,
  name: string,
): Promise<string> {
  // Case-insensitive match on existing clusters.
  const existing = (await sql`
    SELECT id FROM clusters
    WHERE session_id = ${sessionId} AND lower(name) = lower(${name})
    LIMIT 1
  `) as { id: string }[];
  if (existing.length > 0) return existing[0].id;

  // Create it.
  const count = (await sql`
    SELECT COUNT(*)::int AS count FROM clusters WHERE session_id = ${sessionId}
  `) as { count: string }[];
  const idx = Number(count[0]?.count ?? 0);
  const color = PALETTE[idx % PALETTE.length];
  const created = (await sql`
    INSERT INTO clusters (session_id, name, color, sort_order)
    VALUES (${sessionId}, ${name}, ${color}, ${idx})
    RETURNING id
  `) as { id: string }[];
  return created[0].id;
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    session_id,
    raw_text,
    text,
    category,
    prior_art = null,
    branch = null,
    confidence = 'medium',
    parent_id = null,
    cluster_id: forcedClusterId = null,
  } = body;

  if (!session_id || !text) {
    return Response.json({ error: 'session_id and text required' }, { status: 400 });
  }

  const sql = getSql();

  // Resolve cluster: use forced cluster if provided, else resolve by category name.
  const clusterId = forcedClusterId
    ? forcedClusterId
    : category
    ? await resolveCluster(sql, session_id, category)
    : null;

  const rows = await sql`
    INSERT INTO ideas
      (session_id, cluster_id, parent_id, text, raw_text, category, prior_art, branch, confidence)
    VALUES
      (${session_id}, ${clusterId}, ${parent_id}, ${text}, ${raw_text ?? null},
       ${category ?? null}, ${prior_art}, ${branch}, ${confidence})
    RETURNING *
  `;
  return Response.json(rows[0]);
}

export async function PATCH(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { id, cluster_id, text } = body;
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const sql = getSql();
  const rows =
    text !== undefined
      ? await sql`UPDATE ideas SET text = ${text}, cluster_id = ${cluster_id ?? null} WHERE id = ${id} RETURNING *`
      : await sql`UPDATE ideas SET cluster_id = ${cluster_id ?? null} WHERE id = ${id} RETURNING *`;
  if (!rows.length) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(rows[0]);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const sessionId = searchParams.get('session_id');

  const sql = getSql();

  if (id) {
    // Orphan any children rather than deleting them (matches prototype behavior).
    await sql`UPDATE ideas SET parent_id = NULL WHERE parent_id = ${id}`;
    await sql`DELETE FROM ideas WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  if (sessionId) {
    await sql`DELETE FROM ideas WHERE session_id = ${sessionId}`;
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'id or session_id required' }, { status: 400 });
}
