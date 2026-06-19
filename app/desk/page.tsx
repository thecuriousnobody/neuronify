'use client';

import { useEffect, useState } from 'react';
import styles from './desk.module.css';

type Approval = { approver: string; status: string };
type Item = {
  submissionId: string;
  formKey: string;
  city: string;
  submittedAt: string;
  stepTitle: string;
  values: { fieldKey: string; value: unknown }[];
  myScope: string[];
  otherApprovals: Approval[];
  waitingMs: number;
};

const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function humanize(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function headline(item: Item): string {
  // first non-empty text-ish value as the at-a-glance label
  const v = item.values.find((x) => typeof x.value === 'string' && x.value);
  return v ? String(v.value) : pretty(item.formKey);
}

export default function DeskPage() {
  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadQueue() {
    setLoading(true);
    const res = await fetch('/api/desk/queue');
    if (res.status === 401) {
      setDepartment(null);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setDepartment(data.department);
    setItems(data.items);
    setCity(data.items[0]?.city ?? '');
    setLoading(false);
  }

  useEffect(() => {
    loadQueue();
  }, []);

  async function signIn() {
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/desk/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Sign-in failed.');
      setPasscode('');
      await loadQueue();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch('/api/desk/login', { method: 'DELETE' });
    setDepartment(null);
    setItems([]);
  }

  if (loading) {
    return (
      <main className={styles.wrap}>
        <div className={styles.empty}>Loading…</div>
      </main>
    );
  }

  if (!department) {
    return (
      <main className={styles.wrap}>
        <div className={styles.signin}>
          <div className={styles.signinTitle}>Neuronify · Department sign-in</div>
          <div className={styles.signinSub}>Enter your department passcode to review what’s waiting on you.</div>
          <input
            className={styles.input}
            type="password"
            value={passcode}
            placeholder="Passcode"
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && signIn()}
          />
          {error && <div className={styles.error}>{error}</div>}
          <button className={styles.primary} onClick={signIn} disabled={busy || !passcode.trim()}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.brand}>
          Neuronify · <span className={styles.dept}>{pretty(department)}</span>
        </span>
        <span>
          {city && <span className={styles.city}>{city} &nbsp;</span>}
          <button className={styles.exit} onClick={signOut}>
            sign out
          </button>
        </span>
      </div>

      <div className={styles.count}>
        {items.length === 0 ? 'Nothing awaiting your review.' : `${items.length} awaiting your review`}
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>You’re all caught up. ✓</div>
      ) : (
        items.map((item) => (
          <a key={item.submissionId} className={styles.card} href={`/desk/${item.submissionId}`}>
            <div className={styles.cardTop}>
              <span className={styles.cardTitle}>
                {pretty(item.formKey)} · {headline(item)}
              </span>
              <span className={styles.wait}>⏱ {humanize(item.waitingMs)}</span>
            </div>
            <div className={styles.cardMeta}>
              {item.stepTitle} · waiting on you
              {item.otherApprovals.length > 0 &&
                ' · ' +
                  item.otherApprovals
                    .map((a) => `${pretty(a.approver)}: ${a.status === 'approved' ? 'approved ✓' : a.status.replace(/_/g, ' ')}`)
                    .join(', ')}
            </div>
          </a>
        ))
      )}
    </main>
  );
}
