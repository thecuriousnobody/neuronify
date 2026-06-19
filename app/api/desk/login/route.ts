import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/ratelimit';
import { deskConfigured, departmentForPasscode, cookieValueFor, DESK_COOKIE } from '@/lib/desk-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const lim = rateLimit('desk:' + ip);
  if (!lim.ok) return NextResponse.json({ error: lim.reason }, { status: 429 });

  if (!deskConfigured()) {
    return NextResponse.json({ error: 'The approver console is not configured.' }, { status: 503 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const dept = departmentForPasscode(String(body?.passcode ?? ''));
  if (!dept) return NextResponse.json({ error: 'Wrong passcode' }, { status: 401 });

  const res = NextResponse.json({ ok: true, department: dept });
  res.cookies.set(DESK_COOKIE, cookieValueFor(dept) as string, { ...COOKIE_OPTS, maxAge: 60 * 60 * 8 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DESK_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}
