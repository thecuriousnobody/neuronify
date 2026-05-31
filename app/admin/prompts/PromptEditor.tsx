'use client';

import { useState } from 'react';
import styles from './prompts.module.css';

type P = {
  key: string;
  label: string;
  hint: string;
  content: string;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export default function PromptEditor({ prompts }: { prompts: P[] }) {
  return (
    <div className={styles.list}>
      {prompts.map((p) => (
        <Card key={p.key} p={p} />
      ))}
    </div>
  );
}

function Card({ p }: { p: P }) {
  const [content, setContent] = useState(p.content);
  const [saving, setSaving] = useState(false);
  const [isDefault, setIsDefault] = useState(p.isDefault);
  const [msg, setMsg] = useState('');
  const [isErr, setIsErr] = useState(false);

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: p.key, content }),
      });
      if (res.ok) {
        setIsDefault(false);
        setIsErr(false);
        setMsg('Saved — live on the next run.');
      } else {
        const d = await res.json().catch(() => ({}));
        setIsErr(true);
        setMsg(d?.error || 'Save failed');
      }
    } catch {
      setIsErr(true);
      setMsg('Network error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm(`Reset "${p.label}" to the built-in default? Your edits will be discarded.`)) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: p.key, reset: true }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        setIsErr(true);
        setMsg('Reset failed');
        setSaving(false);
      }
    } catch {
      setIsErr(true);
      setMsg('Network error');
      setSaving(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.cardTitle}>{p.label}</div>
          <div className={styles.cardHint}>{p.hint}</div>
        </div>
        <span className={isDefault ? styles.badgeDefault : styles.badgeCustom}>
          {isDefault ? 'default' : 'customized'}
        </span>
      </div>

      <textarea
        className={styles.area}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />

      <div className={styles.cardFoot}>
        <div className={styles.meta}>
          {content.length.toLocaleString()} chars
          {p.updatedBy ? ` · last edit by ${p.updatedBy}` : ''}
        </div>
        <div className={styles.actions}>
          <button className={styles.reset} onClick={reset} type="button" disabled={saving}>
            Reset to default
          </button>
          <button className={styles.save} onClick={save} type="button" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {msg && <div className={isErr ? styles.err : styles.ok}>{msg}</div>}
    </div>
  );
}
