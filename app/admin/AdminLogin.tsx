'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './admin.module.css';

export default function AdminLogin({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d?.error || 'Wrong passcode');
        setBusy(false);
      }
    } catch {
      setErr('Network error');
      setBusy(false);
    }
  };

  return (
    <main className={styles.gate}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.brand}>
          <span className={styles.brandDot} />
          Neuronify <span className={styles.tag}>admin</span>
        </div>
        <div className={styles.gateLabel}>Enter passcode</div>
        <input
          className={styles.input}
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="••••••••"
          autoFocus
          aria-label="Admin passcode"
        />
        <button className={styles.btn} type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        {err && <div className={styles.err}>{err}</div>}
        {!configured && (
          <div className={styles.hint}>
            ADMIN_PASSWORD isn&apos;t set — admin is locked until it&apos;s configured in env.
          </div>
        )}
      </form>
    </main>
  );
}
