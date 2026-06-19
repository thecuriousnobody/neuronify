'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import styles from '../reports.module.css';

type Field = { key: string; label: string; type: string; choices?: string[] };
type Detail = {
  submissionId: string;
  formKey: string;
  status: string;
  values: { fieldKey: string; value: unknown }[];
  fields: Field[];
  needsInput: boolean;
  requestedFields: string[];
  notes: { approver: string; reason: string }[];
};

const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtVal = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : v == null || v === '' ? '—' : String(v));

export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [edited, setEdited] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/v2/my/${id}`);
    if (res.status === 401) {
      router.push('/intake');
      return;
    }
    if (!res.ok) {
      setError('Could not load this report.');
      setLoading(false);
      return;
    }
    const data: Detail = await res.json();
    setD(data);
    // pre-fill editable copy of the requested fields
    const init: Record<string, string | boolean> = {};
    for (const k of data.requestedFields) {
      const f = data.fields.find((x) => x.key === k);
      const v = data.values.find((x) => x.fieldKey === k)?.value;
      if (f?.type === 'boolean') init[k] = v === true;
      else if (v != null) init[k] = String(v);
    }
    setEdited(init);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function resubmit() {
    if (!d || busy) return;
    setBusy(true);
    setError('');
    const values = d.requestedFields.map((k) => {
      const f = d.fields.find((x) => x.key === k);
      const raw = edited[k];
      let value: string | number | boolean | null = raw ?? null;
      if (f?.type === 'boolean') value = raw === true;
      else if (f?.type === 'number' && raw !== '' && raw != null) value = Number(raw);
      return { fieldKey: k, value };
    });
    try {
      const res = await fetch('/api/v2/resubmit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submissionId: id, values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not resubmit.');
      setDone(true);
      setTimeout(() => router.push('/reports'), 1200);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (loading) return <main className={styles.wrap}><div className={styles.empty}>Loading…</div></main>;
  if (!d)
    return (
      <main className={styles.wrap}>
        <button className={styles.back} onClick={() => router.push('/reports')}>← your reports</button>
        <div className={styles.error}>{error || 'Not found.'}</div>
      </main>
    );

  return (
    <main className={styles.wrap}>
      <button className={styles.back} onClick={() => router.push('/reports')}>← your reports</button>
      <div className={styles.header}>
        <span className={styles.title}>{pretty(d.formKey)}</span>
        <a className={styles.who} href={`/track/${id}`}>track →</a>
      </div>

      {done ? (
        <div className={styles.done}>Thanks — your update was sent back to the city.</div>
      ) : d.needsInput ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>A reviewer asked you to update this</div>
          {d.notes.map((n, i) => (
            <div key={i} className={styles.note}>
              <strong>{pretty(n.approver)}:</strong> {n.reason}
            </div>
          ))}
          {d.requestedFields.map((k) => {
            const f = d.fields.find((x) => x.key === k);
            return (
              <div key={k} className={styles.field}>
                <label className={styles.label}>{f?.label ?? pretty(k)}</label>
                {f?.type === 'boolean' ? (
                  <select
                    className={styles.select}
                    value={edited[k] === true ? 'yes' : 'no'}
                    onChange={(e) => setEdited({ ...edited, [k]: e.target.value === 'yes' })}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                ) : f?.type === 'choice' ? (
                  <select className={styles.select} value={(edited[k] as string) ?? ''} onChange={(e) => setEdited({ ...edited, [k]: e.target.value })}>
                    <option value="">—</option>
                    {f.choices?.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input className={styles.input} value={(edited[k] as string) ?? ''} onChange={(e) => setEdited({ ...edited, [k]: e.target.value })} />
                )}
              </div>
            );
          })}
          {error && <div className={styles.error}>{error}</div>}
          <button className={styles.primary} onClick={resubmit} disabled={busy}>
            {busy ? 'Sending…' : 'Resubmit to the city'}
          </button>
        </div>
      ) : (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            {d.status === 'completed' ? 'Complete' : d.status === 'denied' ? 'Not approved' : 'In progress'}
          </div>
          {d.fields.map((f) => (
            <div key={f.key} className={styles.row}>
              <span className={styles.rowKey}>{f.label}</span>
              <span>{f.type === 'attachment' ? '—' : fmtVal(d.values.find((v) => v.fieldKey === f.key)?.value)}</span>
            </div>
          ))}
          <p className={styles.cardMeta} style={{ marginTop: '0.6rem' }}>Nothing needs your input right now.</p>
        </div>
      )}
    </main>
  );
}
