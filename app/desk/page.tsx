'use client';

import { useEffect, useMemo, useState } from 'react';
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

type Case = {
  submissionId: string;
  formKey: string;
  city: string;
  submittedAt: string;
  status: 'open' | 'completed' | 'denied';
  currentStepTitle: string | null;
  currentReviewers: string[];
  elapsedMs: number;
  resolvedAt: string | null;
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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_LABEL: Record<Case['status'], string> = {
  open: 'In review',
  completed: 'Resolved',
  denied: 'Denied',
};

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

  const [tab, setTab] = useState<'queue' | 'all'>('queue');
  const [cases, setCases] = useState<Case[]>([]);
  const [casesLoaded, setCasesLoaded] = useState(false);
  const [casesLoading, setCasesLoading] = useState(false);
  const [selected, setSelected] = useState<Case | null>(null);

  // filters for the All-cases view
  const [q, setQ] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

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

  async function loadCases() {
    setCasesLoading(true);
    const res = await fetch('/api/desk/cases');
    if (res.status === 401) {
      setDepartment(null);
      setCasesLoading(false);
      return;
    }
    const data = await res.json();
    setCases(data.cases ?? []);
    if (!city) setCity(data.cases?.[0]?.city ?? '');
    setCasesLoaded(true);
    setCasesLoading(false);
  }

  useEffect(() => {
    loadQueue();
  }, []);

  // lazy-load the full city list the first time the All-cases tab is opened
  useEffect(() => {
    if (tab === 'all' && !casesLoaded && department) loadCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, department]);

  const categories = useMemo(
    () => Array.from(new Set(cases.map((c) => c.formKey))).sort(),
    [cases],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cases.filter((c) => {
      if (catFilter && c.formKey !== catFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (needle) {
        const hay = `${c.formKey} ${c.currentStepTitle ?? ''} ${c.currentReviewers.join(' ')} ${c.submissionId}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [cases, q, catFilter, statusFilter]);

  function exportCsv() {
    const headers = ['Reference', 'Category', 'Status', 'Current reviewer', 'Age', 'Submitted', 'Resolved'];
    const rows = filtered.map((c) => [
      c.submissionId,
      pretty(c.formKey),
      STATUS_LABEL[c.status],
      c.currentReviewers.map(pretty).join('; ') || (c.status === 'open' ? '' : '—'),
      humanize(c.elapsedMs),
      fmtDate(c.submittedAt),
      c.resolvedAt ? fmtDate(c.resolvedAt) : '',
    ]);
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neuronify-cases-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
    setCases([]);
    setCasesLoaded(false);
    setTab('queue');
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
          <a className={styles.intakeLink} href="/desk/intake">Front desk →</a>
          &nbsp;
          <button className={styles.exit} onClick={signOut}>
            sign out
          </button>
        </span>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'queue'}
          className={`${styles.tab} ${tab === 'queue' ? styles.tabActive : ''}`}
          onClick={() => setTab('queue')}
        >
          Cases waiting your review{items.length > 0 ? ` (${items.length})` : ''}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'all'}
          className={`${styles.tab} ${tab === 'all' ? styles.tabActive : ''}`}
          onClick={() => setTab('all')}
        >
          All cases in the city
        </button>
      </div>

      {tab === 'queue' ? (
        items.length === 0 ? (
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
        )
      ) : (
        <div className={styles.allWrap}>
          <div className={styles.allMain}>
            <div className={styles.filters}>
              <input
                className={styles.filterInput}
                placeholder="Search reference, reviewer, step…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select className={styles.filterSelect} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{pretty(c)}</option>
                ))}
              </select>
              <select className={styles.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Any status</option>
                <option value="open">In review</option>
                <option value="completed">Resolved</option>
                <option value="denied">Denied</option>
              </select>
              <button className={styles.csvBtn} onClick={exportCsv} disabled={filtered.length === 0}>
                Export CSV
              </button>
            </div>

            {casesLoading ? (
              <div className={styles.empty}>Loading cases…</div>
            ) : filtered.length === 0 ? (
              <div className={styles.empty}>No cases match these filters.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Current reviewer</th>
                      <th>Age</th>
                      <th>Target (SLA)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr
                        key={c.submissionId}
                        className={`${styles.trow} ${selected?.submissionId === c.submissionId ? styles.trowSel : ''}`}
                        onClick={() => setSelected(c)}
                      >
                        <td>{pretty(c.formKey)}</td>
                        <td>
                          <span className={`${styles.pill} ${styles['pill_' + c.status]}`}>{STATUS_LABEL[c.status]}</span>
                        </td>
                        <td>{c.currentReviewers.map(pretty).join(', ') || '—'}</td>
                        <td>{humanize(c.elapsedMs)}</td>
                        <td className={styles.muted}>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={styles.tableFoot}>{filtered.length} case{filtered.length === 1 ? '' : 's'} shown</div>
          </div>

          <aside className={styles.detailPane}>
            {selected ? (
              <>
                <div className={styles.dpTitle}>{pretty(selected.formKey)}</div>
                <div className={styles.dpRef}>{selected.submissionId.slice(0, 8)}…</div>
                <dl className={styles.dpGrid}>
                  <dt>Status</dt>
                  <dd><span className={`${styles.pill} ${styles['pill_' + selected.status]}`}>{STATUS_LABEL[selected.status]}</span></dd>
                  <dt>Current step</dt>
                  <dd>{selected.currentStepTitle ? pretty(selected.currentStepTitle) : '—'}</dd>
                  <dt>Reviewer</dt>
                  <dd>{selected.currentReviewers.map(pretty).join(', ') || '—'}</dd>
                  <dt>Age</dt>
                  <dd>{humanize(selected.elapsedMs)}</dd>
                  <dt>Submitted</dt>
                  <dd>{fmtDate(selected.submittedAt)}</dd>
                  {selected.resolvedAt && (
                    <>
                      <dt>Resolved</dt>
                      <dd>{fmtDate(selected.resolvedAt)}</dd>
                    </>
                  )}
                </dl>
                <a className={styles.dpOpen} href={`/desk/${selected.submissionId}`}>Open full review →</a>
              </>
            ) : (
              <div className={styles.dpEmpty}>Select a case to see details.</div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
