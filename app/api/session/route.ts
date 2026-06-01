import { getSql } from '@/lib/db';
import { getOrCreateSession } from '@/lib/session';
import { resolveCity } from '@/lib/cities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Current rolling session for a city (creates one if none open). ?city=<slug>
export async function GET(req: Request) {
  const city = resolveCity(new URL(req.url).searchParams.get('city'));
  const session = await getOrCreateSession(city.db);
  return Response.json(session, { headers: { 'cache-control': 'no-store' } });
}

// Operator: close that city's open session and start a fresh one. { city?, label? }
export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }
  const city = resolveCity(body?.city);
  const label = body?.label ? String(body.label).slice(0, 120) : null;

  const sql = getSql();
  await sql`update sessions set ended_at = now() where ended_at is null and city = ${city.db}`;
  const created = (await sql`
    insert into sessions (city, label) values (${city.db}, ${label}) returning *
  `) as any[];
  return Response.json(created[0]);
}
