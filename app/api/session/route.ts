import { getSql } from '@/lib/db';
import { getOrCreateSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Current rolling session (creates one if none open).
export async function GET() {
  const session = await getOrCreateSession();
  return Response.json(session, { headers: { 'cache-control': 'no-store' } });
}

// Operator: close any open sessions and start a fresh one. Optional { label }.
export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }
  const label = body?.label ? String(body.label).slice(0, 120) : null;

  const sql = getSql();
  await sql`update sessions set ended_at = now() where ended_at is null`;
  const created = (await sql`
    insert into sessions (city, label) values ('Peoria, IL', ${label}) returning *
  `) as any[];
  return Response.json(created[0]);
}
