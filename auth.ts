import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const googleConfigured = () =>
  !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [Google],
  callbacks: {
    // Allow-list enforced at sign-in: only configured admin emails get in.
    // (Two-factor: a valid Google identity AND membership on ADMIN_EMAILS.)
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      const allow = adminEmails();
      return !!email && allow.length > 0 && allow.includes(email);
    },
  },
});

// Re-checked on every admin render — never trust just the presence of a session.
export function isGoogleAdmin(
  session: { user?: { email?: string | null } | null } | null,
): boolean {
  const email = session?.user?.email?.toLowerCase();
  const allow = adminEmails();
  return !!email && allow.length > 0 && allow.includes(email);
}
