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
  currentStepKey: string | null;
  steps: Step[];
  timeline: { at: string; label: string }[];
  timing: { internalMs: number; externalMs: number };
  reassignTargets: string[];
  intake: { transcript: string; source: string; at: string } | null;
};

const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const APPROVAL_LABEL: Record<string, string> = {
  pending: 'in review',
  approved: 'approved',
  awaiting_resubmit: 'needs resident input',
  denied: 'declined',
};

// map a step's status to a visual state: done (green), denied (red),
// active (amber — the current step), pending (hollow — not yet started)
function stepState(status: string): 'done' | 'denied' | 'active' | 'pending' {
  if (status === 'closed') return 'done';
  if (status === 'denied') return 'denied';
  if (status === 'open') return 'active';
  return 'pending';
}

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
  const [tab, setTab] = useState<'form' | 'workflow' | 'log'>('form');
  const [panel, setPanel] = useState<'none' | 'approve' | 'resubmit' | 'deny'>('none');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  // reassignment form
  const [reTo, setReTo] = useState('');
  const [reReason, setReReason] = useState('');
  const [reCategory, setReCategory] = useState('');
  const [reBusy, setReBusy] = useState(false);

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

  // Silent refresh (no full-page loading flash) — used after an action so the
  // workflow circles update in place instead of bouncing back to the queue.
  async function refresh() {
    const res = await fetch(`/api/desk/submission/${id}`);
    if (res.ok) setDetail(await res.json());
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
    if (decision === 'approved') payload.reason = note.trim() || undefined; // "what work was completed?"
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
          ? 'Approved — your portion is signed off. Use “← back to queue” when you’re done.'
          : decision === 'denied'
            ? 'Denied. The resident has been notified.'
            : 'Re-submit requested. The resident has been notified.',
      );
      setPanel('none');
      setNote('');
      await refresh(); // reflect the new state in the workflow circles, in place
      setBusy(false);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function reassign() {
    if (reBusy || !reTo || !reReason.trim()) return;
    setReBusy(true);
    setError('');
    try {
      const res = await fetch('/api/desk/reassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          submissionId: id,
          toApprover: reTo,
          reason: reReason.trim(),
          category: reCategory.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Reassignment failed.');
      setDone(`Reassigned to ${pretty(reTo)}. They’ve been notified with your reason.`);
      setReTo('');
      setReReason('');
      setReCategory('');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReBusy(false);
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

      {done && <div className={styles.done}>{done}</div>}
      {error && panel === 'none' && !reBusy && <div className={styles.error}>{error}</div>}

      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={tab === 'form'} className={`${styles.tab} ${tab === 'form' ? styles.tabActive : ''}`} onClick={() => setTab('form')}>
          Form
        </button>
        <button role="tab" aria-selected={tab === 'workflow'} className={`${styles.tab} ${tab === 'workflow' ? styles.tabActive : ''}`} onClick={() => setTab('workflow')}>
          Workflow
        </button>
        <button role="tab" aria-selected={tab === 'log'} className={`${styles.tab} ${tab === 'log' ? styles.tabActive : ''}`} onClick={() => setTab('log')}>
          Chat &amp; change log
        </button>
      </div>

      {/* ── FORM TAB — action area at top (if you're the reviewer), then the record ── */}
      {tab === 'form' && (
        <>
          {detail.canAct && !done && (
            <div className={styles.section}>
              <div className={styles.stepGuide}>
                You’re the reviewer for <strong>{pretty(detail.currentStepKey ?? '')}</strong>. Sign off on your portion,
                request more information, deny with a reason, or reassign it under the Workflow tab.
              </div>
              <div className={styles.actions}>
                <button className={styles.approve} onClick={() => { setPanel(panel === 'approve' ? 'none' : 'approve'); setNote(''); }} disabled={busy}>
                  Approve
                </button>
                <button className={styles.neutral} onClick={() => { setPanel(panel === 'resubmit' ? 'none' : 'resubmit'); setNote(''); }} disabled={busy}>
                  Request re-submit
                </button>
                <button className={styles.danger} onClick={() => { setPanel(panel === 'deny' ? 'none' : 'deny'); setNote(''); }} disabled={busy}>
                  Deny…
                </button>
              </div>

              {panel === 'approve' && (
                <div className={styles.panel}>
                  <div className={styles.sectionLabel}>What work was completed? (optional)</div>
                  <textarea
                    className={styles.textarea}
                    rows={2}
                    placeholder="e.g. Pothole filled and road resurfaced on 7/9."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button className={styles.approve} onClick={() => act('approved')} disabled={busy}>
                    {busy ? 'Signing off…' : 'Confirm approval'}
                  </button>
                </div>
              )}

              {panel === 'resubmit' && (
                <div className={styles.panel}>
                  <div className={styles.sectionLabel}>Which fields should the resident redo?</div>
                  {detail.myScope.map((k) => {
                    const f = detail.fields.find((x) => x.key === k);
                    return (
                      <label key={k} className={styles.check}>
                        <input type="checkbox" checked={!!picked[k]} onChange={(e) => setPicked({ ...picked, [k]: e.target.checked })} />{' '}
                        {f?.label ?? pretty(k)}
                      </label>
                    );
                  })}
                  <div className={styles.sectionLabel}>What additional information do you need?</div>
                  <textarea
                    className={styles.textarea}
                    rows={2}
                    placeholder="Tell the resident what to add or fix."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button className={styles.neutral} onClick={() => act('requires_resubmit')} disabled={busy || !Object.values(picked).some(Boolean)}>
                    {busy ? 'Sending…' : 'Send re-submit request'}
                  </button>
                </div>
              )}

              {panel === 'deny' && (
                <div className={styles.panel}>
                  <div className={styles.sectionLabel}>Why was this request denied? (required — shared with the resident)</div>
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
              {error && panel !== 'none' && <div className={styles.error}>{error}</div>}
            </div>
          )}

          {!detail.canAct && !done && (
            <div className={styles.section}>
              <div className={styles.closed}>
                {detail.status === 'completed'
                  ? 'This submission has completed all reviews.'
                  : detail.status === 'denied'
                    ? 'This submission was denied.'
                    : detail.myApprovalStatus === 'approved'
                      ? 'You’ve already approved your portion. Waiting on the other departments.'
                      : 'Nothing for you to act on right now.'}
              </div>
            </div>
          )}

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
        </>
      )}

      {/* ── WORKFLOW TAB — step circles + reassignment ── */}
      {tab === 'workflow' && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Workflow</div>
            {detail.steps.length === 0 ? (
              <div className={styles.closed}>No steps.</div>
            ) : (
              <ol className={styles.steps}>
                {detail.steps.map((s) => {
                  const state = stepState(s.status);
                  return (
                    <li key={s.key} className={`${styles.step} ${styles['step_' + state]}`}>
                      <span className={styles.stepDot} aria-hidden="true" />
                      <div className={styles.stepBody}>
                        <span className={styles.stepTitle}>{s.title || pretty(s.key)}</span>
                        {s.status !== 'not_started' && s.approvals.length > 0 && (
                          <span className={styles.stepApprovals}>
                            {s.approvals.map((a) => (
                              <span key={a.approver} className={`${styles.appChip} ${styles['app_' + a.status]}`}>
                                {pretty(a.approver)}: {APPROVAL_LABEL[a.status] ?? a.status}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {detail.canAct && !done && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Reassign this case</div>
              <div className={styles.stepGuide}>
                Wrong department? Hand this step to another one. They’ll be notified — and a reason is required so they
                have the context.
              </div>
              {detail.reassignTargets.length === 0 ? (
                <div className={styles.closed}>No other departments are configured to reassign to.</div>
              ) : (
                <div className={styles.panel}>
                  <select className={styles.filterSelect} value={reTo} onChange={(e) => setReTo(e.target.value)} aria-label="Reassign to department">
                    <option value="">Reassign to…</option>
                    {detail.reassignTargets.map((d) => (
                      <option key={d} value={d}>{pretty(d)}</option>
                    ))}
                  </select>
                  <input
                    className={styles.textarea}
                    placeholder="New case type (optional) — e.g. Private Property"
                    value={reCategory}
                    onChange={(e) => setReCategory(e.target.value)}
                  />
                  <textarea
                    className={styles.textarea}
                    rows={2}
                    placeholder="Why is this being reassigned? (required)"
                    value={reReason}
                    onChange={(e) => setReReason(e.target.value)}
                  />
                  <button className={styles.neutral} onClick={reassign} disabled={reBusy || !reTo || !reReason.trim()}>
                    {reBusy ? 'Reassigning…' : 'Reassign'}
                  </button>
                  {error && reBusy === false && <div className={styles.error}>{error}</div>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── CHAT & CHANGE LOG TAB — original conversation, then the change log ── */}
      {tab === 'log' && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionLabel}>
              Resident’s intake {detail.intake ? `(${detail.intake.source})` : ''}
            </div>
            {detail.intake && detail.intake.transcript ? (
              <div className={styles.transcript}>{detail.intake.transcript}</div>
            ) : (
              <div className={styles.logHint}>No intake transcript was preserved for this case.</div>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Change log — who did what, when</div>
            <ul className={styles.timeline}>
              {detail.timeline.map((t, i) => (
                <li key={i} className={styles.tl}>
                  <span className={styles.tlTime}>{fmtTime(t.at)}</span>
                  <span>{t.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </main>
  );
}
