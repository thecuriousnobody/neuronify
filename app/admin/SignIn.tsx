import { signIn } from '@/auth';
import PasscodeForm from './PasscodeForm';
import styles from './admin.module.css';

export default function SignIn({
  googleEnabled,
  passcodeConfigured,
}: {
  googleEnabled: boolean;
  passcodeConfigured: boolean;
}) {
  return (
    <main className={styles.gate}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandDot} />
          Neuronify <span className={styles.tag}>admin</span>
        </div>
        <div className={styles.gateLabel}>Sign in</div>

        {googleEnabled && (
          <form
            action={async () => {
              'use server';
              await signIn('google', { redirectTo: '/admin' });
            }}
          >
            <button className={styles.google} type="submit">
              Continue with Google
            </button>
          </form>
        )}

        {googleEnabled && passcodeConfigured && <div className={styles.or}>— or —</div>}

        {passcodeConfigured && <PasscodeForm />}

        {!googleEnabled && !passcodeConfigured && (
          <div className={styles.hint}>Admin isn&apos;t configured yet.</div>
        )}
      </div>
    </main>
  );
}
