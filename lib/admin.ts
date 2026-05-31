import { cookies } from 'next/headers';
import crypto from 'node:crypto';

// Passcode-gated admin. Fail-closed: if ADMIN_PASSWORD is unset, nobody is
// admin and login always fails. The cookie stores a hash of the passcode, not
// the passcode itself.

export const ADMIN_COOKIE = 'np_admin';

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

export function expectedToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Constant-time passcode check. Returns false if not configured (fail closed).
export function checkPassword(pw: string): boolean {
  const real = process.env.ADMIN_PASSWORD;
  if (!real || !pw) return false;
  return safeEqual(pw, real);
}

// Is the current request an authenticated admin? Reads the session cookie.
export function isAdmin(): boolean {
  const expected = expectedToken();
  if (!expected) return false; // not configured → deny
  const got = cookies().get(ADMIN_COOKIE)?.value;
  if (!got) return false;
  return safeEqual(got, expected);
}
