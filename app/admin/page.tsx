import { isAdmin, adminConfigured } from '@/lib/admin';
import { getSql } from '@/lib/db';
import AdminLogin from './AdminLogin';
import LogoutButton from './LogoutButton';
import styles from './admin.module.css';

export const dynamic = 'force-dynamic';

type Row = { email: string; created_at: string; source: string | null; note: string | null };

export default async function AdminPage() {
  if (!isAdmin()) {
    return <AdminLogin configured={adminConfigured()} />;
  }

  const sql = getSql();
  const rows = (await sql`
    select email, created_at, source, note
    from access_requests
    order by created_at desc
  `) as Row[];

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <span className={styles.brandDot} />
          Neuronify <span className={styles.tag}>admin</span>
        </div>
        <LogoutButton />
      </div>

      <div className={styles.headRow}>
        <h1 className={styles.title}>
          Early-access <span className={styles.it}>waitlist</span>
        </h1>
        <div className={styles.count}>{rows.length}</div>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>No signups yet. They&apos;ll appear here the moment someone requests access.</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Email</th>
              <th>When</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email}>
                <td className={styles.email}>{r.email}</td>
                <td className={styles.when}>
                  {new Date(r.created_at).toLocaleString('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </td>
                <td className={styles.src}>{r.source ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
