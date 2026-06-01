import { getSql } from '@/lib/db';
import { getOrCreateSession } from '@/lib/session';
import { rateLimit } from '@/lib/ratelimit';
import { triage } from '@/lib/triage';
import { resolveCity } from '@/lib/cities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LEN = 2000;

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  const limit = rateLimit(ip);
  if (!limit.ok) {
    return Response.json({ error: limit.reason }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawText = String(body?.raw_text ?? '').trim();
  const source = body?.source === 'voice' ? 'voice' : 'text';

  if (!rawText) {
    return Response.json({ error: 'Say something about your city first.' }, { status: 400 });
  }
  if (rawText.length > MAX_LEN) {
    return Response.json({ error: `Keep it under ${MAX_LEN} characters.` }, { status: 400 });
  }

  const sql = getSql();

  // Resolve city + session (provided session, or the city's rolling one).
  const city = resolveCity(body?.city);
  let sessionId = body?.session_id as string | undefined;
  if (!sessionId) sessionId = (await getOrCreateSession(city.db)).id;

  // Insert the raw submission first so it surfaces on the wall immediately,
  // even if triage is slow or fails.
  const inserted = (await sql`
    insert into submissions (session_id, source, raw_text, status)
    values (${sessionId}, ${source}, ${rawText}, 'pending')
    returning id
  `) as { id: string }[];
  const id = inserted[0].id;

  try {
    const t = await triage(rawText, city.prompt);
    await sql`
      update submissions set
        status = 'triaged',
        summary = ${t.summary},
        category = ${t.category},
        severity = ${t.severity},
        intervention = ${t.intervention},
        cost_low_usd = ${t.cost_low_usd},
        cost_high_usd = ${t.cost_high_usd},
        cost_basis = ${t.cost_basis},
        actionable_by_city = ${t.actionable_by_city},
        referral = ${t.referral},
        confidence = ${t.confidence},
        needs_more_info = ${t.needs_more_info}
      where id = ${id}
    `;
    return Response.json({ id, session_id: sessionId, status: 'triaged', ...t });
  } catch (err: any) {
    await sql`
      update submissions set status = 'error', error = ${String(err?.message ?? err)}
      where id = ${id}
    `;
    // Still a 200 — the signal was received and is on the wall; triage can be retried.
    return Response.json(
      { id, session_id: sessionId, status: 'error', error: 'Triage failed, but your signal was received.' },
      { status: 200 },
    );
  }
}
