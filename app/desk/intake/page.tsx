'use client';

// Staff intake console — the confirm gate. A transcript comes in; the agent's
// proposal (filled form + classification + composed graph) is shown for review;
// staff light-edit (severity, routing department) and Confirm & Launch, which
// freezes the graph and opens the workflow. Viewer + light edit, not an authoring
// canvas — the agent composed it, the human is accountable for launching it.

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './intake.module.css';

const SEVERITIES = ['safety_critical', 'high', 'medium', 'low'] as const;
type Severity = (typeof SEVERITIES)[number];

type FieldDef = { key: string; label: string; type: string; required: boolean };
type FieldValue = { fieldKey: string; value: unknown };
type Classification = { category: string; severity: Severity; department: string; rationale: string };
type GraphNode = {
  key: string;
  kind: 'start' | 'intake' | 'approval' | 'notify' | 'condition' | 'done';
  title: string;
  approvals?: { approver: string; scope: string[] }[];
  note?: string;
  layout?: { x: number; y: number };
};
type GraphEdge = { from: string; to: string; when?: string };
type WorkflowGraph = { key: string; title: string; version: number; nodes: GraphNode[]; edges: GraphEdge[] };
type Proposal = {
  form: { key: string; title: string; city: string; fields: FieldDef[] };
  values: FieldValue[];
  missing: string[];
  classification: Classification;
  graph: WorkflowGraph;
  routableDepartments: string[];
};

const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const NODE_W = 150;
const NODE_H = 66;

/** Re-space a linear node chain and regenerate its edges. Scenario-A graphs are
 *  a single path, so edits (add/remove a step) just relink the chain. */
function relinkLinear(nodes: GraphNode[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const spaced = nodes.map((n, i) => ({ ...n, layout: { x: 24 + i * 212, y: 250 } }));
  const edges = spaced.slice(0, -1).map((n, i) => ({ from: n.key, to: spaced[i + 1].key }));
  return { nodes: spaced, edges };
}

const SAMPLE =
  "There's a deep pothole at Main Street and 5th Avenue. It's taking up almost the whole right lane and cars keep swerving into oncoming traffic to miss it. It's definitely dangerous — someone's going to get hurt.";

type Pending = { id: string; formKey: string; city: string; transcript: string; source: string; createdAt: string };

export default function IntakeConsole() {
  const [transcript, setTranscript] = useState('');
  const [digesting, setDigesting] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [values, setValues] = useState<FieldValue[]>([]);
  const [severity, setSeverity] = useState<Severity>('medium');
  const [department, setDepartment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchedId, setLaunchedId] = useState<string | null>(null);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [modalText, setModalText] = useState<{ title: string; text: string } | null>(null);
  const [diligence, setDiligence] = useState(false);
  const [voted, setVoted] = useState<'up' | 'down' | null>(null);
  const [launchMeta, setLaunchMeta] = useState<{ submittedAt: string; launchedBy: string } | null>(null);

  const [me, setMe] = useState<string | null>(null);

  async function loadQueue() {
    try {
      const res = await fetch('/api/v2/pending');
      if (!res.ok) return;
      const data = await res.json();
      setQueue(Array.isArray(data.items) ? data.items : []);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    loadQueue();
    // Who am I? Make the role explicit — staff wear one department per session.
    fetch('/api/desk/queue')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.department && setMe(d.department))
      .catch(() => {});
  }, []);

  function reviewPending(p: Pending) {
    setPendingId(p.id);
    setTranscript(p.transcript);
    setProposal(null);
    setLaunchedId(null);
    digest(p.transcript);
  }

  async function digest(t?: string) {
    const source = (t ?? transcript).trim();
    if (!source) return;
    setError(null);
    setLaunchedId(null);
    setDigesting(true);
    try {
      const res = await fetch('/api/v2/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formKey: 'pothole_report', transcript: source }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(res.status === 401 ? 'Staff sign-in required — sign in on the Desk first.' : data.error || 'Digest failed.');
        return;
      }
      const p = data as Proposal;
      setProposal(p);
      setValues(p.values);
      setSeverity(p.classification.severity);
      setDepartment(p.classification.department);
      setGraph(p.graph);
      setSelected(null);
      setDiligence(false);
      setVoted(null);
      setLaunchMeta(null);
    } catch {
      setError('Network error.');
    } finally {
      setDigesting(false);
    }
  }

  // ── Canvas light-edit operations. All of them keep the graph a valid linear
  // chain (relinkLinear), so what launches always compiles. ──

  /** The routing dropdown re-targets the PRIMARY review node. */
  function changeDepartment(dept: string) {
    setDepartment(dept);
    setGraph((g) =>
      g
        ? {
            ...g,
            nodes: g.nodes.map((n) =>
              n.key === 'departmental_review'
                ? { ...n, title: `${pretty(dept)} review`, approvals: [{ approver: dept, scope: n.approvals?.[0]?.scope ?? [] }] }
                : n,
            ),
          }
        : g,
    );
  }

  /** Insert another departmental review step before "notify". */
  function addStep(dept: string) {
    setGraph((g) => {
      if (!g) return g;
      let key = `review_${dept}`;
      let i = 2;
      while (g.nodes.some((n) => n.key === key)) key = `review_${dept}_${i++}`;
      const scope = g.nodes.find((n) => n.key === 'departmental_review')?.approvals?.[0]?.scope ?? [];
      const node: GraphNode = {
        key,
        kind: 'approval',
        title: `${pretty(dept)} review`,
        approvals: [{ approver: dept, scope }],
      };
      const idx = g.nodes.findIndex((n) => n.kind === 'notify');
      const nodes = [...g.nodes];
      nodes.splice(idx === -1 ? nodes.length - 1 : idx, 0, node);
      const relinked = relinkLinear(nodes);
      setSelected(key);
      return { ...g, ...relinked };
    });
  }

  /** Remove a review step (the graph must keep at least one approval). */
  function removeStep(key: string) {
    setGraph((g) => {
      if (!g) return g;
      const approvals = g.nodes.filter((n) => n.kind === 'approval');
      if (approvals.length <= 1) return g; // fail closed — the engine would reject it anyway
      const relinked = relinkLinear(g.nodes.filter((n) => n.key !== key));
      setSelected(null);
      return { ...g, ...relinked };
    });
  }

  /** Staff annotation on a node — frozen into the audit record at launch. */
  function setNote(key: string, note: string) {
    setGraph((g) =>
      g ? { ...g, nodes: g.nodes.map((n) => (n.key === key ? { ...n, note: note || undefined } : n)) } : g,
    );
  }

  const selectedNode = useMemo(() => graph?.nodes.find((n) => n.key === selected) ?? null, [graph, selected]);

  /** Thumbs on the composition — persisted with the proposal snapshot as a tuning signal. */
  async function vote(verdict: 'up' | 'down') {
    if (voted) return;
    setVoted(verdict);
    try {
      await fetch('/api/v2/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: 'composed_workflow',
          verdict,
          context: {
            transcript: transcript.slice(0, 2000),
            classification: proposal?.classification,
            severity,
            department,
            graphNodes: graph?.nodes.map((n) => ({ key: n.key, kind: n.kind, title: n.title })),
          },
        }),
      });
    } catch {
      /* best-effort — the vote UI already registered */
    }
  }

  async function launch() {
    if (!proposal || !graph) return;
    setError(null);
    setLaunching(true);
    try {
      const res = await fetch('/api/v2/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formKey: proposal.form.key, values, graph, source: 'voice', pendingId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Launch failed.');
        return;
      }
      setLaunchedId(data.submissionId);
      setLaunchMeta({ submittedAt: data.submittedAt, launchedBy: data.launchedBy });
      // Clear the just-launched drop from the queue.
      if (pendingId) {
        setQueue((q) => q.filter((p) => p.id !== pendingId));
        setPendingId(null);
      }
    } catch {
      setError('Network error.');
    } finally {
      setLaunching(false);
    }
  }

  function setValue(key: string, value: unknown) {
    setValues((prev) => {
      const next = prev.filter((v) => v.fieldKey !== key);
      next.push({ fieldKey: key, value });
      return next;
    });
  }
  const valueOf = (key: string) => values.find((v) => v.fieldKey === key)?.value ?? '';

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div className={styles.eyebrow}>
          Neuronify · Intake console
          {me && <span className={styles.meBadge}>signed in as {pretty(me)}</span>}
        </div>
        <h1>Review &amp; launch a report</h1>
        <p className={styles.sub}>The agent digests a resident&apos;s report. You confirm what it understood and where it goes — then launch.</p>
        <nav className={styles.crumbs}>
          <a href="/report">Resident voice door (the mic) →</a>
          <a href="/desk">Department queue →</a>
        </nav>
        <p className={styles.subHint}>
          Residents speak at <code>/report</code>; their drops land in the queue below. The box here is a manual fallback.
        </p>
      </header>

      {/* Queue — pending resident drops awaiting review */}
      {queue.length > 0 && (
        <section className={styles.card}>
          <div className={styles.queueHead}>
            <span className={styles.label}>Waiting for review</span>
            <span className={styles.queueCount}>{queue.length}</span>
          </div>
          <ul className={styles.queue}>
            {queue.map((p) => (
              <li key={p.id} className={`${styles.queueItem} ${pendingId === p.id ? styles.queueActive : ''}`}>
                <div className={styles.queueText}>{p.transcript}</div>
                <button
                  className={styles.seeMore}
                  onClick={() => setModalText({ title: 'Resident’s report', text: p.transcript })}
                  type="button"
                >
                  See more
                </button>
                <button className={styles.review} onClick={() => reviewPending(p)} type="button">Review →</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Step 1 — the drop */}
      <section className={styles.card}>
        <label className={styles.label} htmlFor="t">Resident&apos;s report (transcript)</label>
        <textarea
          id="t"
          className={styles.textarea}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Paste or type the transcribed voice drop…"
          rows={4}
        />
        <div className={styles.row}>
          <button
            className={styles.ghost}
            onClick={() => setModalText({ title: 'Resident’s report (full transcript)', text: transcript })}
            disabled={!transcript.trim()}
            type="button"
          >
            Read full ⤢
          </button>
          <button className={styles.ghost} onClick={() => setTranscript(SAMPLE)} type="button">Use sample</button>
          <button className={styles.primary} onClick={() => digest()} disabled={digesting || !transcript.trim()} type="button">
            {digesting ? 'Digesting…' : 'Digest'}
          </button>
        </div>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {launchedId && (
        <div className={styles.receipt}>
          <div className={styles.receiptHead}>Launch record</div>
          <dl className={styles.receiptGrid}>
            <dt>Reference</dt>
            <dd><code>{launchedId}</code></dd>
            <dt>Launched</dt>
            <dd>{launchMeta ? new Date(launchMeta.submittedAt).toLocaleString() : '—'}</dd>
            <dt>Launched by</dt>
            <dd>{launchMeta ? pretty(launchMeta.launchedBy) : '—'}</dd>
            <dt>Route</dt>
            <dd>{graph ? graph.nodes.filter((n) => n.kind === 'approval').map((n) => n.title).join(' → ') : '—'}</dd>
          </dl>
          <div className={styles.receiptFoot}>
            Frozen into the audit ledger. <a href={`/track/${launchedId}`}>Track it →</a>
          </div>
        </div>
      )}

      {/* Step 2 — the proposal */}
      {proposal && graph && !launchedId && (
        <section className={styles.proposal}>
          <div className={styles.panel}>
            <h2 className={styles.h2}>What the agent understood</h2>
            <div className={styles.rationale}>“{proposal.classification.rationale}”</div>

            <div className={styles.fields}>
              {proposal.form.fields.map((f) => {
                const missing = proposal.missing.includes(f.key);
                return (
                  <div key={f.key} className={styles.field}>
                    <label className={styles.fieldLabel}>
                      {f.label}
                      {f.required && <span className={styles.req}> *</span>}
                      {missing && <span className={styles.missing}> missing</span>}
                    </label>
                    {f.type === 'attachment' ? (
                      <div className={styles.attach}>Photo added at review</div>
                    ) : f.type === 'boolean' ? (
                      <select className={styles.input} value={String(valueOf(f.key))} onChange={(e) => setValue(f.key, e.target.value === 'true')}>
                        <option value="">—</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input className={styles.input} value={String(valueOf(f.key))} onChange={(e) => setValue(f.key, e.target.value)} />
                    )}
                  </div>
                );
              })}
            </div>

            <div className={styles.classify}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Severity</label>
                <select className={styles.input} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Route to department</label>
                <select className={styles.input} value={department} onChange={(e) => changeDepartment(e.target.value)}>
                  {proposal.routableDepartments.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
                </select>
              </div>
            </div>

            <label className={styles.diligence}>
              <input
                type="checkbox"
                checked={diligence}
                onChange={(e) => setDiligence(e.target.checked)}
              />
              <span>
                I&apos;ve reviewed the details, severity, and routing. Launching freezes this
                workflow into the audit record under my department&apos;s name.
              </span>
            </label>
            <button className={styles.launch} onClick={launch} disabled={launching || !diligence} type="button">
              {launching ? 'Launching…' : 'Confirm & Launch'}
            </button>
          </div>

          <div className={styles.canvasWrap}>
            <div className={styles.canvasBar}>
              <div className={styles.canvasLabel}>Composed workflow · click a step to inspect · drag to pan</div>
              <div className={styles.barRight}>
              {voted ? (
                <span className={styles.votedNote}>Noted — thank you</span>
              ) : (
                <span className={styles.voteWrap}>
                  <button className={styles.voteBtn} onClick={() => vote('up')} type="button" aria-label="Good composition">👍</button>
                  <button className={styles.voteBtn} onClick={() => vote('down')} type="button" aria-label="Off-base composition">👎</button>
                </span>
              )}
              <select
                className={styles.addStep}
                value=""
                onChange={(e) => e.target.value && addStep(e.target.value)}
                aria-label="Add a review step"
              >
                <option value="">+ Add review step…</option>
                {proposal.routableDepartments.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
              </select>
              </div>
            </div>
            <Canvas graph={graph} severity={severity} selected={selected} onSelect={setSelected} />
            {selectedNode && (
              <div className={styles.inspector}>
                <div className={styles.inspectorHead}>
                  <span className={styles.inspectorKind}>{selectedNode.kind.toUpperCase()}</span>
                  <strong className={styles.inspectorTitle}>{selectedNode.title}</strong>
                  <button className={styles.inspectorClose} onClick={() => setSelected(null)} type="button">✕</button>
                </div>
                {selectedNode.kind === 'approval' && (
                  <div className={styles.inspectorMeta}>
                    Signs off on: {selectedNode.approvals?.[0]?.scope.join(', ') || '(all fields)'}
                  </div>
                )}
                <label className={styles.fieldLabel}>
                  Staff note — frozen into the audit record at launch
                </label>
                <textarea
                  className={styles.noteBox}
                  value={selectedNode.note ?? ''}
                  onChange={(e) => setNote(selectedNode.key, e.target.value)}
                  rows={2}
                  placeholder="e.g. Verified location by phone — sign is fully down, expedite."
                />
                {selectedNode.kind === 'approval' && graph.nodes.filter((n) => n.kind === 'approval').length > 1 && (
                  <button className={styles.removeBtn} onClick={() => removeStep(selectedNode.key)} type="button">
                    Remove this step
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {modalText && (
        <div className={styles.overlay} onClick={() => setModalText(null)} role="presentation">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={modalText.title}>
            <div className={styles.modalHead}>
              <span>{modalText.title}</span>
              <button className={styles.inspectorClose} onClick={() => setModalText(null)} type="button">✕</button>
            </div>
            <div className={styles.modalBody}>{modalText.text}</div>
          </div>
        </div>
      )}
    </main>
  );
}

function Canvas({
  graph,
  severity,
  selected,
  onSelect,
}: {
  graph: WorkflowGraph;
  severity: Severity;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const width = Math.max(...graph.nodes.map((n) => (n.layout?.x ?? 0) + NODE_W)) + 40;
  const height = Math.max(...graph.nodes.map((n) => (n.layout?.y ?? 0) + NODE_H)) + 40;

  // Grab-and-pan: drag the dotted background to scroll the graph. A drag that
  // starts on a node is ignored, so nodes stay clickable.
  const panRef = useRef<HTMLDivElement | null>(null);
  const panState = useRef({ startX: 0, startLeft: 0, active: false });

  function panStart(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(`.${styles.node}`)) return;
    const el = panRef.current;
    if (!el) return;
    panState.current = { startX: e.clientX, startLeft: el.scrollLeft, active: true };
    el.setPointerCapture(e.pointerId);
  }
  function panMove(e: React.PointerEvent) {
    const el = panRef.current;
    if (!el || !panState.current.active) return;
    el.scrollLeft = panState.current.startLeft - (e.clientX - panState.current.startX);
  }
  function panEnd(e: React.PointerEvent) {
    const el = panRef.current;
    if (!el) return;
    panState.current.active = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }

  return (
    <div
      ref={panRef}
      className={styles.canvas}
      onPointerDown={panStart}
      onPointerMove={panMove}
      onPointerUp={panEnd}
      onPointerCancel={panEnd}
    >
      <div className={styles.canvasInner} style={{ width, height }}>
        <svg className={styles.edges} width={width} height={height}>
          {graph.edges.map((e, i) => {
            const a = byKey.get(e.from)?.layout;
            const b = byKey.get(e.to)?.layout;
            if (!a || !b) return null;
            const ax = a.x + NODE_W, ay = a.y + NODE_H / 2;
            const bx = b.x, by = b.y + NODE_H / 2;
            const d = `M ${ax} ${ay} C ${ax + 44} ${ay}, ${bx - 44} ${by}, ${bx} ${by}`;
            return <path key={i} d={d} className={styles.edge} />;
          })}
        </svg>
        {graph.nodes.map((n) => (
          <div
            key={n.key}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(selected === n.key ? null : n.key)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(selected === n.key ? null : n.key)}
            className={`${styles.node} ${styles[`kind_${n.kind}`] ?? ''} ${selected === n.key ? styles.nodeSelected : ''}`}
            style={{ left: n.layout?.x ?? 0, top: n.layout?.y ?? 0, width: NODE_W, height: NODE_H }}
          >
            <div className={styles.nodeKind}>{n.kind.toUpperCase()}</div>
            <div className={styles.nodeTitle}>{n.title}</div>
            {n.kind === 'approval' && <div className={`${styles.sevPip} ${styles[`sev_${severity}`] ?? ''}`} />}
            {n.note && <div className={styles.noteBadge}>note</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
