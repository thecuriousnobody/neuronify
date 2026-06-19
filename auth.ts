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
    // Beta: ANY verified Google account may sign in — this is the citizen gate
    // for /intake. Admin access is NOT granted here; it's enforced separately by
    // isGoogleAdmin()/requireAdmin against ADMIN_EMAILS at the admin routes, so a
    // non-admin holding a session is expected and safe.
    async signIn({ profile }) {
      return !!profile?.email;
    },
  },
  events: {
    // Record beta testers as they sign in — the "who's trying it" data. Lives in
    // the beta layer (nf_beta_testers), separate from the anonymous submissions.
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      if (!email) return;
      try {
        const { getSql } = await import('@/lib/db');
        await getSql()`
          insert into nf_beta_testers (email, name, image, first_seen, last_seen)
          values (${email}, ${profile?.name ?? null}, ${(profile as any)?.picture ?? null}, now(), now())
          on conflict (email) do update set
            last_seen = now(),
            name = coalesce(excluded.name, nf_beta_testers.name)
        `;
      } catch (err) {
        console.error('[beta] tester upsert failed:', err);
      }
    },
  },
});

/** The signed-in user (any verified Google account), or null. */
export async function currentUser(): Promise<{ email: string; name?: string | null } | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  return email ? { email, name: session?.user?.name } : null;
}

// Re-checked on every admin render — never trust just the presence of a session.
export function isGoogleAdmin(
  session: { user?: { email?: string | null } | null } | null,
): boolean {
  const email = session?.user?.email?.toLowerCase();
  const allow = adminEmails();
  return !!email && allow.length > 0 && allow.includes(email);
}
