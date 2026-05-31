'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './admin.module.css';

export default function PasscodeForm() {
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
    <form className={styles.pcform} onSubmit={submit}>
      <input
        className={styles.input}
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="Passcode"
        aria-label="Admin passcode"
      />
      <button className={styles.btnGhost} type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Use passcode'}
      </button>
      {err && <div className={styles.err}>{err}</div>}
    </form>
  );
}
