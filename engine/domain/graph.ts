// Neuronify v2 — the COMPOSED, FROZEN workflow graph.
//
// A WorkflowDefinition (see types.ts) is a linear list of steps, authored once
// and versioned. A WorkflowGraph is different: it is COMPOSED per issue by the
// intake agent from a vetted palette, then FROZEN into the `workflow.opened`
// event so the audit log carries its own definition — immutable by construction,
// nothing external to fetch. It is also what the Simulink-style canvas renders.
//
// `compileGraph` (../workflow/graph.ts) reduces a graph to the executable
// `WorkflowDefinition` the existing engine already runs, so the whole pure
// command/reducer core is reused unchanged. For scenario A the graph is a single
// linear path; branch/convergence semantics grow in with scenario B.

import type { StepApproval } from './types';

/**
 * The vetted palette. The intake agent may ONLY assemble a graph from these —
 * it cannot invent step types. That constraint is what keeps agent-composed
 * workflows defensible.
 */
export type NodeKind =
  | 'start' // single entry; no work, hands off to its successor
  | 'intake' // the form was collected at submit — presentational in the graph
  | 'approval' // a departmental AND-gate — the only kind that holds up the flow
  | 'notify' // relay to the resident; the engine emits comms on step close
  | 'condition' // branch on a predicate (scenario B; not executed by A)
  | 'done'; // single terminal

/** One node on the composed graph. Approval nodes carry the real work. */
export interface GraphNode {
  /** Unique within the graph, e.g. "public_works_review". */
  key: string;
  kind: NodeKind;
  title: string;
  /**
   * Approval nodes: the departmental sign-offs (portion-scoped), identical in
   * shape to a WorkflowStep's approvals. Several here = a parallel AND-gate.
   */
  approvals?: StepApproval[];
  /** Fields that must be present for this node to be decidable. */
  requiresFields?: string[];
  /** Attachment field keys this node requires. */
  requiresAttachments?: string[];
  /** Condition nodes: a human-readable predicate; edges carry the branch labels. */
  condition?: { description: string };
  /** Canvas layout hint. Presentational only; ignored by execution. */
  layout?: { x: number; y: number };
}

/** A directed edge. `when` labels the branch on edges leaving a condition node. */
export interface GraphEdge {
  from: string;
  to: string;
  /** Only on edges leaving a condition node, e.g. "if historic" / "if not". */
  when?: string;
}

/**
 * The composed workflow for one issue. Frozen into `workflow.opened` at launch;
 * never mutated thereafter (new facts spawn a linked issue, not an edit).
 */
export interface WorkflowGraph {
  key: string;
  title: string;
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
