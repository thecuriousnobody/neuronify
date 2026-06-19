import { auth, signIn, googleConfigured } from '@/auth';
import IntakeClient from './IntakeClient';
import styles from './intake.module.css';

export const dynamic = 'force-dynamic';

// Server-side beta gate: you must be signed in with Google to file a report.
// /track stays open (read-only). The chat UI lives in IntakeClient.
export default async function IntakePage() {
  const session = await auth();
  if (session?.user) return <IntakeClient />;

  return (
    <main className={styles.wrap}>
      <div className={styles.done}>
        <div className={styles.doneTitle}>File a report</div>
        <p className={styles.doneText}>
          Neuronify is in private beta. Sign in with Google to file a report — it takes a second and lets
          us follow up with testers.
        </p>
        {googleConfigured() ? (
          <form
            action={async () => {
              'use server';
              await signIn('google', { redirectTo: '/intake' });
            }}
          >
            <button className={styles.primary} type="submit" style={{ marginTop: '1rem' }}>
              Continue with Google
            </button>
          </form>
        ) : (
          <p className={styles.doneText} style={{ marginTop: '1rem', opacity: 0.7 }}>
            Sign-in isn’t configured in this environment yet.
          </p>
        )}
      </div>
    </main>
  );
}
