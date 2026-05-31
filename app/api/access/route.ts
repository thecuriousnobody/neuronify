import { getSql } from '@/lib/db';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Early-access waitlist capture. Public endpoint → rate-limited + size-capped.
export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  const limit = rateLimit(ip);
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return Response.json({ error: 'Enter a valid email' }, { status: 400 });
  }
  const note = body?.note ? String(body.note).slice(0, 500) : null;

  try {
    const sql = getSql();
    // Idempotent — re-submitting the same email is a no-op, not an error.
    const rows = await sql`
      insert into access_requests (email, source, note)
      values (${email}, ${'landing'}, ${note})
      on conflict (email) do nothing
      returning id
    `;
    return Response.json({ ok: true, new: rows.length > 0 });
  } catch (err: any) {
    return Response.json({ error: 'Could not save — try again.' }, { status: 500 });
  }
}
