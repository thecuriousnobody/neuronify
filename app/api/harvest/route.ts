import { getSql } from '@/lib/db';
import { generateHarvest, type IdeaForHarvest } from '@/lib/harvest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sessionId = body?.session_id;
  if (!sessionId) return Response.json({ error: 'session_id required' }, { status: 400 });

  const sql = getSql();

  // Fetch all ideas with their cluster name and parent text for context.
  const rows = (await sql`
    SELECT
      i.id,
      i.text,
      c.name AS cluster_name,
      p.text AS parent_text,
      i.prior_art,
      i.branch
    FROM ideas i
    LEFT JOIN clusters c ON c.id = i.cluster_id
    LEFT JOIN ideas p ON p.id = i.parent_id
    WHERE i.session_id = ${sessionId}
    ORDER BY c.sort_order, i.created_at
  `) as {
    id: string;
    text: string;
    cluster_name: string | null;
    parent_text: string | null;
    prior_art: string | null;
    branch: string | null;
  }[];

  if (rows.length === 0) {
    return Response.json({ error: 'No ideas in this session' }, { status: 400 });
  }

  const ideas: IdeaForHarvest[] = rows.map((r) => ({
    id: r.id,
    text: r.text,
    lane: r.cluster_name ?? 'Uncategorised',
    parent_text: r.parent_text,
    prior_art: r.prior_art,
    branch: r.branch,
  }));

  try {
    const markdown = await generateHarvest(ideas);
    return Response.json({ markdown });
  } catch (err: any) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
