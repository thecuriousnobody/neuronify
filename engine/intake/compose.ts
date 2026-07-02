// Composition: turn a classification into a WorkflowGraph the engine can run.
//
// Scenario A is deterministic — a single-department linear path built from the
// vetted palette (start → intake → departmental approval → notify → done). The
// LLM does NOT author graph structure; it only classifies, and this function
// maps the result onto known-good primitives. That keeps agent-composed
// workflows defensible: the shape is always a graph the engine already trusts.
//
// Scenario B (branches, multi-department, conditions) grows here later, keyed off
// richer classification — the composer is the seam where "dynamic" gets its reach
// without ever letting the model emit raw structure.

import type { WorkflowGraph } from '../domain/graph';
import type { Classification } from './digest';

export interface ComposeOptions {
  /** The form this issue was filed on, e.g. "pothole_report". Names the flow. */
  formKey: string;
  /** Field keys the department signs off on. Defaults to every filled field. */
  scope: string[];
}

/** Prettify a department key for display: "public_works" → "Public Works". */
function titleCase(key: string): string {
  return key
    .split(/[_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Compose a single-department linear workflow for one classified issue. The
 * result is always a graph `compileGraph` accepts (validated by the tests).
 */
export function composeGraph(cls: Classification, opts: ComposeOptions): WorkflowGraph {
  const dept = cls.department;
  // Stable node key (independent of the department) so a staff light-edit can
  // swap the approver without rewriting the edges that reference this node.
  const reviewKey = 'departmental_review';
  return {
    key: `${opts.formKey}_flow`,
    title: `${titleCase(opts.formKey.replace(/_/g, ' '))} — ${titleCase(dept)}`,
    version: 1,
    nodes: [
      { key: 'start', kind: 'start', title: 'Report starts', layout: { x: 24, y: 250 } },
      { key: 'intake', kind: 'intake', title: 'Collect report', layout: { x: 208, y: 250 } },
      {
        key: reviewKey,
        kind: 'approval',
        title: `${titleCase(dept)} review`,
        approvals: [{ approver: dept, scope: opts.scope }],
        layout: { x: 420, y: 250 },
      },
      { key: 'notify', kind: 'notify', title: 'Notify resident', layout: { x: 640, y: 250 } },
      { key: 'done', kind: 'done', title: 'Resolved', layout: { x: 824, y: 250 } },
    ],
    edges: [
      { from: 'start', to: 'intake' },
      { from: 'intake', to: reviewKey },
      { from: reviewKey, to: 'notify' },
      { from: 'notify', to: 'done' },
    ],
  };
}
