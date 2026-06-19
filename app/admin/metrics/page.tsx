import { auth, isGoogleAdmin, googleConfigured } from '@/auth';
import { isAdmin as passcodeAdmin, adminConfigured } from '@/lib/admin';
import { engineEnv } from '@/lib/engine';
import { computeMetrics } from '@/engine';
import SignIn from '../SignIn';
import styles from './metrics.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function dur(ms: number): string {
  if (ms < 1000) return '0m';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default async function MetricsPage() {
  const session = await auth();
  const viaGoogle = isGoogleAdmin(session);
  const viaPasscode = !viaGoogle && passcodeAdmin();
  if (!viaGoogle && !viaPasscode) {
    return <SignIn googleEnabled={googleConfigured()} passcodeConfigured={adminConfigured()} />;
  }

  const m = await computeMetrics(engineEnv());

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <a href="/" className={styles.brand}>
          Neuronify <span className={styles.tag}>metrics</span>
        </a>
        <a className={styles.back} href="/admin">
          ← admin
        </a>
      </div>

      <h1 className={styles.title}>
        Flow &amp; <span className={styles.it}>timing</span>
      </h1>

      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardVal}>{m.total}</div>
          <div className={styles.cardLabel}>submissions</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardVal}>{m.byStatus.open}</div>
          <div className={styles.cardLabel}>in progress</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardVal}>{m.byStatus.completed}</div>
          <div className={styles.cardLabel}>completed</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardVal}>{m.byStatus.denied}</div>
          <div className={styles.cardLabel}>not approved</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardVal}>{Math.round(m.resubmitRate * 100)}%</div>
          <div className={styles.cardLabel}>hit a re-submit ({m.resubmitRequests} total)</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardVal}>{dur(m.avgInternalMs + m.avgExternalMs)}</div>
          <div className={styles.cardLabel}>avg time per submission</div>
          <div className={styles.split}>
            <span className={styles.internal}>{dur(m.avgInternalMs)} city</span>
            <span className={styles.external}>{dur(m.avgExternalMs)} citizen</span>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Where time goes, by step (total across all submissions)</div>
        {m.perStep.length === 0 ? (
          <div className={styles.empty}>No step activity yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Step</th>
                <th className={styles.internal}>City time</th>
                <th className={styles.external}>Citizen time</th>
              </tr>
            </thead>
            <tbody>
              {m.perStep.map((s) => (
                <tr key={s.stepKey}>
                  <td>{pretty(s.stepKey)}</td>
                  <td>{dur(s.internalMs)}</td>
                  <td>{dur(s.externalMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Waiting on right now, by department</div>
        {m.pendingByDepartment.length === 0 ? (
          <div className={styles.empty}>Nothing pending — the queue is clear.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Department</th>
                <th>Open items</th>
              </tr>
            </thead>
            <tbody>
              {m.pendingByDepartment.map((p) => (
                <tr key={p.approver}>
                  <td>{pretty(p.approver)}</td>
                  <td>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.disclaimer}>
        Derived live from the append-only audit log. “City time” = waiting on a department; “citizen time” =
        awaiting a resident re-submit.
      </div>
    </main>
  );
}
