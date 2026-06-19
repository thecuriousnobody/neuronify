// Per-department passcode auth for the city-side approver console ("desk").
// Extends the v1 admin pattern (lib/admin.ts) to multiple departments.
//
// Config — one env var, comma-separated dept:passcode pairs:
//   DESK_PASSCODES="clerk:clerkpass,public_works:pwpass,fire:firepass"
//
// The cookie stores "<dept>:<sha256(passcode)>" — never the passcode itself.
// Fail-closed: if DESK_PASSCODES is unset, nobody can sign in.

import { cookies } from 'next/headers';
import crypto from 'node:crypto';

export const DESK_COOKIE = 'np_desk';

function passcodeMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of (process.env.DESK_PASSCODES || '').split(',')) {
    const i = pair.indexOf(':');
    if (i === -1) continue;
    const dept = pair.slice(0, i).trim();
    const pass = pair.slice(i + 1).trim();
    if (dept && pass) m.set(dept, pass);
  }
  return m;
}

export function deskConfigured(): boolean {
  return passcodeMap().size > 0;
}

export function departments(): string[] {
  return [...passcodeMap().keys()];
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** The department this passcode belongs to (constant-time), or null. */
export function departmentForPasscode(passcode: string): string | null {
  if (!passcode) return null;
  for (const [dept, real] of passcodeMap()) {
    if (safeEqual(passcode, real)) return dept;
  }
  return null;
}

/** Cookie value to set for a signed-in department, or null if unknown. */
export function cookieValueFor(dept: string): string | null {
  const real = passcodeMap().get(dept);
  return real ? `${dept}:${sha256(real)}` : null;
}

/** The verified department from the request cookie, or null if not signed in. */
export function currentDepartment(): string | null {
  const raw = cookies().get(DESK_COOKIE)?.value;
  if (!raw) return null;
  const i = raw.indexOf(':');
  if (i === -1) return null;
  const dept = raw.slice(0, i);
  const got = raw.slice(i + 1);
  const real = passcodeMap().get(dept);
  if (!real) return null;
  return safeEqual(got, sha256(real)) ? dept : null;
}
