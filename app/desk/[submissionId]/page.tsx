'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import styles from '../desk.module.css';

type Field = { key: string; label: string; type: string };
type Approval = { approver: string; status: string };
type Step = { key: string; title: string; status: string; approvals: Approval[] };
type Detail = {
  department: string;
  submissionId: string;
  formKey: string;
  city: string;
  submittedAt: string;
  source: string;
  status: string;
  values: { fieldKey: string; value: unknown }[];
  fields: Field[];
  myScope: string[];
  myApprovalStatus: string | null;
  canAct: boolean;
  steps: Step[];
  timeline: { at: string; label: string }[];
  timing: { internalMs: number; externalMs: number };
};

const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function fmtVal(v: unknown): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (v == null || v === '') return '—';
  return String(v);
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function DeskDetailPage() {
  const params = useParams<{ submissionId: string }>();
  const router = useRouter();
  const id = params.submissionId;

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<'none' | 'resubmit' | 'deny'>('none');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/desk/submission/${id}`);
    if (res.status === 401) {
      router.push('/desk');
      return;
    }
    if (!res.ok) {
      setError('Could not load this submission.');
      setLoading(false);
      return;
    }
    setDetail(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(decision: 'approved' | 'denied' | 'requires_resubmit') {
    if (busy) return;
    setBusy(true);
    setError('');
    const payload: any = { submissionId: id, decision };
    if (decision === 'denied') payload.reason = note.trim();
    if (decision === 'requires_resubmit') {
      payload.resubmitScope = Object.keys(picked).filter((k) => picked[k]);
      payload.reason = note.trim() || undefined;
    }
    try {
      const res = await fetch('/api/desk/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Action failed.');
      setDone(
        decision === 'approved'
          ? 'Approved. Returning to your queue…'
          : decision === 'denied'
            ? 'Denied. The resident has been notified.'
            : 'Re-submit requested. The resident has been notified.',
      );
      setTimeout(() => router.push('/desk'), 1100);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.wrap}>
        <div className={styles.empty}>Loading…</div>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className={styles.wrap}>
        <button className={styles.back} onClick={() => router.push('/desk')}>
          ← back to queue
        </button>
        <div className={styles.error}>{error || 'Not found.'}</div>
      </main>
    );
  }

  const scope = new Set(detail.myScope);

  return (
    <main className={styles.wrap}>
      <button className={styles.back} onClick={() => router.push('/desk')}>
        ← back to queue
      </button>

      <div className={styles.header}>
        <span className={styles.brand}>
          {pretty(detail.formKey)} <span className={styles.city}>· {detail.submissionId.slice(0, 8)}…</span>
        </span>
        <span className={styles.city}>
          {detail.city} · {detail.source} · submitted {fmtTime(detail.submittedAt)}
        </span>
      </div>

      {/* full record — read-only */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>The record</div>
        {detail.fields.map((f) => {
          const v = detail.values.find((x) => x.fieldKey === f.key)?.value;
          return (
            <div key={f.key} className={`${styles.row} ${scope.has(f.key) ? styles.mine : ''}`}>
              <span className={styles.rowKey}>{f.label}</span>
              <span className={styles.rowVal}>{f.type === 'attachment' ? '(attachment — upload coming soon)' : fmtVal(v)}</span>
            </div>
          );
        })}
      </div>

      {/* the department's portion */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Your portion to sign off ({pretty(detail.department)})</div>
        {detail.myScope.length === 0 ? (
          <div className={styles.closed}>You have no active portion on this submission.</div>
        ) : (
          detail.myScope.map((k) => {
            const f = detail.fields.find((x) => x.key === k);
            return (
              <span key={k} className={styles.chip}>
                {f?.label ?? pretty(k)}
              </span>
            );
          })
        )}
      </div>

      {/* timeline */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Timeline</div>
        <ul className={styles.timeline}>
          {detail.timeline.map((t, i) => (
            <li key={i} className={styles.tl}>
              <span className={styles.tlTime}>{fmtTime(t.at)}</span>
              <span>{t.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* actions */}
      <div className={styles.section}>
        {done ? (
          <div className={styles.done}>{done}</div>
        ) : detail.canAct ? (
          <>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.actions}>
              <button className={styles.approve} onClick={() => act('approved')} disabled={busy}>
                Approve
              </button>
              <button
                className={styles.neutral}
                onClick={() => {
                  setPanel(panel === 'resubmit' ? 'none' : 'resubmit');
                  setNote('');
                }}
                disabled={busy}
              >
                Request re-submit
              </button>
              <button
                className={styles.danger}
                onClick={() => {
                  setPanel(panel === 'deny' ? 'none' : 'deny');
                  setNote('');
                }}
                disabled={busy}
              >
                Deny…
              </button>
            </div>

            {panel === 'resubmit' && (
              <div className={styles.panel}>
                <div className={styles.sectionLabel}>Which fields should the resident redo?</div>
                {detail.myScope.map((k) => {
                  const f = detail.fields.find((x) => x.key === k);
                  return (
                    <label key={k} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={!!picked[k]}
                        onChange={(e) => setPicked({ ...picked, [k]: e.target.checked })}
                      />{' '}
                      {f?.label ?? pretty(k)}
                    </label>
                  );
                })}
                <textarea
                  className={styles.textarea}
                  rows={2}
                  placeholder="Note to the resident (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button
                  className={styles.neutral}
                  onClick={() => act('requires_resubmit')}
                  disabled={busy || !Object.values(picked).some(Boolean)}
                >
                  {busy ? 'Sending…' : 'Send re-submit request'}
                </button>
              </div>
            )}

            {panel === 'deny' && (
              <div className={styles.panel}>
                <div className={styles.sectionLabel}>Reason for denial (required — shared with the resident)</div>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  placeholder="e.g. This location is county-maintained, not city."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button className={styles.danger} onClick={() => act('denied')} disabled={busy || !note.trim()}>
                  {busy ? 'Submitting…' : 'Confirm denial'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className={styles.closed}>
            {detail.status === 'completed'
              ? 'This submission has completed all reviews.'
              : detail.status === 'denied'
                ? 'This submission was denied.'
                : detail.myApprovalStatus === 'approved'
                  ? 'You’ve already approved your portion. Waiting on the other departments.'
                  : 'Nothing for you to act on right now.'}
          </div>
        )}
      </div>
    </main>
  );
}
