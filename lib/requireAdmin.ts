import { auth, isGoogleAdmin } from '@/auth';
import { isAdmin as passcodeAdmin } from '@/lib/admin';

// Single source of truth for "is this request an admin?" — works in both
// server components and route handlers. Either path grants access:
//   - a valid Google session whose email is on ADMIN_EMAILS, or
//   - a valid passcode cookie.
export async function isAuthedAdmin(): Promise<boolean> {
  if (passcodeAdmin()) return true;
  try {
    return isGoogleAdmin(await auth());
  } catch {
    return false;
  }
}

// Who is acting, for audit fields. Returns the Google email or 'passcode'.
export async function adminActor(): Promise<string> {
  if (passcodeAdmin()) return 'passcode';
  try {
    const session = await auth();
    return session?.user?.email ?? 'admin';
  } catch {
    return 'admin';
  }
}
