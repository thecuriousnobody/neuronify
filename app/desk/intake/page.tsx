'use client';

// Staff intake console — the confirm gate. A transcript comes in; the agent's
// proposal (filled form + classification + composed graph) is shown for review;
// staff light-edit (severity, routing department) and Confirm & Launch, which
// freezes the graph and opens the workflow. Viewer + light edit, not an authoring
// canvas — the agent composed it, the human is accountable for launching it.

import { useEffect, useMemo, useState } from 'react';
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
  useEffect(() => { loadQueue(); }, []);

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
    } catch {
      setError('Network error.');
    } finally {
      setDigesting(false);
    }
  }

  // The live graph reflects the staff's chosen department (stable node key means
  // we only relabel the approval node — no edge surgery).
  const liveGraph = useMemo<WorkflowGraph | null>(() => {
    if (!proposal) return null;
    return {
      ...proposal.graph,
      nodes: proposal.graph.nodes.map((n) =>
        n.kind === 'approval'
          ? { ...n, title: `${pretty(department)} review`, approvals: [{ approver: department, scope: n.approvals?.[0]?.scope ?? [] }] }
          : n,
      ),
    };
  }, [proposal, department]);

  async function launch() {
    if (!proposal || !liveGraph) return;
    setError(null);
    setLaunching(true);
    try {
      const res = await fetch('/api/v2/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formKey: proposal.form.key, values, graph: liveGraph, source: 'voice', pendingId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Launch failed.');
        return;
      }
      setLaunchedId(data.submissionId);
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
        <div className={styles.eyebrow}>Neuronify · Intake console</div>
        <h1>Review &amp; launch a report</h1>
        <p className={styles.sub}>The agent digests a resident&apos;s report. You confirm what it understood and where it goes — then launch.</p>
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
          <button className={styles.ghost} onClick={() => setTranscript(SAMPLE)} type="button">Use sample</button>
          <button className={styles.primary} onClick={() => digest()} disabled={digesting || !transcript.trim()} type="button">
            {digesting ? 'Digesting…' : 'Digest'}
          </button>
        </div>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {launchedId && (
        <div className={styles.success}>
          Launched. Submission <code>{launchedId.slice(0, 8)}</code> is live.{' '}
          <a href={`/track/${launchedId}`}>Track it →</a>
        </div>
      )}

      {/* Step 2 — the proposal */}
      {proposal && liveGraph && !launchedId && (
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
                <select className={styles.input} value={department} onChange={(e) => setDepartment(e.target.value)}>
                  {proposal.routableDepartments.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
                </select>
              </div>
            </div>

            <button className={styles.launch} onClick={launch} disabled={launching} type="button">
              {launching ? 'Launching…' : 'Confirm & Launch'}
            </button>
            <p className={styles.hint}>Launching freezes this workflow and starts the clock. You&apos;re the accountable human on this decision.</p>
          </div>

          <div className={styles.canvasWrap}>
            <div className={styles.canvasLabel}>Composed workflow</div>
            <Canvas graph={liveGraph} severity={severity} />
          </div>
        </section>
      )}
    </main>
  );
}

function Canvas({ graph, severity }: { graph: WorkflowGraph; severity: Severity }) {
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const width = Math.max(...graph.nodes.map((n) => (n.layout?.x ?? 0) + NODE_W)) + 40;
  const height = Math.max(...graph.nodes.map((n) => (n.layout?.y ?? 0) + NODE_H)) + 40;

  return (
    <div className={styles.canvas} style={{ minWidth: width, minHeight: height }}>
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
          className={`${styles.node} ${styles[`kind_${n.kind}`] ?? ''}`}
          style={{ left: n.layout?.x ?? 0, top: n.layout?.y ?? 0, width: NODE_W, height: NODE_H }}
        >
          <div className={styles.nodeKind}>{n.kind.toUpperCase()}</div>
          <div className={styles.nodeTitle}>{n.title}</div>
          {n.kind === 'approval' && <div className={`${styles.sevPip} ${styles[`sev_${severity}`] ?? ''}`} />}
        </div>
      ))}
    </div>
  );
}
