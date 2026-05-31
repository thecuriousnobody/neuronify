import { NextResponse } from 'next/server';
import { checkPassword, expectedToken, adminConfigured, ADMIN_COOKIE } from '@/lib/admin';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
};

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  // Rate limit login attempts (brute-force slowdown).
  const lim = rateLimit('admin:' + ip);
  if (!lim.ok) return NextResponse.json({ error: lim.reason }, { status: 429 });

  if (!adminConfigured()) {
    return NextResponse.json({ error: 'Admin is not configured.' }, { status: 503 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!checkPassword(String(body?.password ?? ''))) {
    return NextResponse.json({ error: 'Wrong passcode' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, expectedToken() as string, {
    ...COOKIE_OPTS,
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return res;
}

// Logout.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}
