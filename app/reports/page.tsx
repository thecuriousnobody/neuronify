import { redirect } from 'next/navigation';
import { currentUser } from '@/auth';
import { engineEnv } from '@/lib/engine';
import { getInstanceView } from '@/engine';
import { listMySubmissionIds } from '@/lib/beta';
import styles from './reports.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default async function ReportsPage() {
  const user = await currentUser();
  if (!user) redirect('/intake');

  const env = engineEnv();
  const ids = await listMySubmissionIds(user!.email);
  const items = [];
  for (const id of ids) {
    const view = await getInstanceView(env, id);
    if (!view) continue;
    const openStep = view.instance.steps.find((s) => s.status === 'open');
    const needsInput = !!openStep?.approvals.some((a) => a.status === 'awaiting_resubmit');
    items.push({
      id,
      formKey: view.submission.formKey,
      submittedAt: view.submission.submittedAt,
      status: view.instance.status,
      needsInput,
    });
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Your reports</span>
        <span className={styles.who}>{user!.name ?? user!.email}</span>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          You haven’t filed anything yet.
          <br />
          <a className={styles.newLink} href="/intake">
            File a report →
          </a>
        </div>
      ) : (
        items.map((it) => {
          const badge = it.needsInput
            ? { cls: styles.bAction, label: 'Needs your input' }
            : it.status === 'completed'
              ? { cls: styles.bComplete, label: 'Complete' }
              : it.status === 'denied'
                ? { cls: styles.bDenied, label: 'Not approved' }
                : { cls: styles.bProgress, label: 'In progress' };
          return (
            <a key={it.id} className={styles.card} href={`/reports/${it.id}`}>
              <div className={styles.cardTop}>
                <span className={styles.cardTitle}>{pretty(it.formKey)}</span>
                <span className={`${styles.badge} ${badge.cls}`}>{badge.label}</span>
              </div>
              <div className={styles.cardMeta}>
                Submitted{' '}
                {new Date(it.submittedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            </a>
          );
        })
      )}
    </main>
  );
}
