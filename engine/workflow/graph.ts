// v2 bridge: compile a composed WorkflowGraph down to the executable
// WorkflowDefinition the existing engine already runs, and load a live instance
// straight from the log (the graph is frozen in `workflow.opened`, so no external
// definition is fetched — the audit log is fully self-describing).
//
// Scenario A is a single linear path, so compilation is a walk from the entry
// node collecting the approval nodes in order. Branch/convergence (condition
// nodes, fan-out) is scenario B: we fail loudly rather than silently mis-execute.

import type {
  AuditEvent,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStep,
} from '../domain/types';
import type { GraphEdge, GraphNode, WorkflowGraph } from '../domain/graph';
import type { CommandCtx, CommandResult } from './commands';
import type { Submission } from '../domain/types';
import { startWorkflow } from './commands';
import { deriveInstance } from './state';
import { fail } from './errors';

/**
 * Reduce a composed graph to executable steps. Approval nodes become steps in
 * path order; start/intake/notify/done are presentational and carry no step.
 * Throws GRAPH_* on anything malformed or not-yet-supported (fail closed).
 */
export function compileGraph(graph: WorkflowGraph): WorkflowDefinition {
  const nodes = new Map<string, GraphNode>(graph.nodes.map((n) => [n.key, n]));

  const outgoing = new Map<string, GraphEdge[]>();
  const indegree = new Map<string, number>();
  for (const n of graph.nodes) {
    outgoing.set(n.key, []);
    indegree.set(n.key, 0);
  }
  for (const e of graph.edges) {
    if (!nodes.has(e.from)) fail('GRAPH_INVALID', `edge from unknown node "${e.from}"`);
    if (!nodes.has(e.to)) fail('GRAPH_INVALID', `edge to unknown node "${e.to}"`);
    outgoing.get(e.from)!.push(e);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  // Entry: the explicit `start`, else the unique indegree-0 node.
  let entry = graph.nodes.find((n) => n.kind === 'start');
  if (!entry) {
    const roots = graph.nodes.filter((n) => (indegree.get(n.key) ?? 0) === 0);
    if (roots.length !== 1)
      fail('GRAPH_INVALID', `graph needs exactly one entry node; found ${roots.length}`);
    entry = roots[0];
  }

  // Walk the single linear path, collecting approval nodes as steps.
  const steps: WorkflowStep[] = [];
  const seen = new Set<string>();
  let cursor: GraphNode | undefined = entry;
  while (cursor) {
    const node: GraphNode = cursor;
    if (seen.has(node.key)) fail('GRAPH_INVALID', `cycle detected at node "${node.key}"`);
    seen.add(node.key);

    if (node.kind === 'condition')
      fail('GRAPH_BRANCHING_NOT_SUPPORTED', 'condition/branch nodes arrive with scenario B');

    if (node.kind === 'approval') {
      const approvals = node.approvals ?? [];
      if (approvals.length === 0)
        fail('GRAPH_INVALID', `approval node "${node.key}" has no approvals`);
      steps.push({
        key: node.key,
        title: node.title,
        approvals,
        ...(node.requiresFields ? { requiresFields: node.requiresFields } : {}),
        ...(node.requiresAttachments ? { requiresAttachments: node.requiresAttachments } : {}),
      });
    }

    const outs: GraphEdge[] = outgoing.get(node.key) ?? [];
    if (outs.length > 1)
      fail('GRAPH_BRANCHING_NOT_SUPPORTED', `node "${node.key}" fans out; branching arrives with scenario B`);
    cursor = outs.length === 1 ? nodes.get(outs[0].to) : undefined;
  }

  return { id: graph.key, key: graph.key, title: graph.title, version: graph.version, steps };
}

/**
 * Open a workflow from a composed graph. Compiles it, freezes the graph into the
 * `workflow.opened` event, and opens the first step — the accountable-human launch.
 */
export function startGraphWorkflow(
  submission: Submission,
  graph: WorkflowGraph,
  ctx: CommandCtx,
): CommandResult & { instanceId: string } {
  const def = compileGraph(graph);
  return startWorkflow(submission, def, ctx, { graph });
}

/** A live workflow reconstructed purely from its log, plus its frozen graph + compiled def. */
export interface GraphFlow {
  graph: WorkflowGraph;
  def: WorkflowDefinition;
  instance: WorkflowInstance;
}

/**
 * Load a v2 workflow from the event log alone. Reads the frozen graph out of
 * `workflow.opened`, compiles it, and folds the log into current state. Returns
 * null before the workflow has opened; throws GRAPH_SNAPSHOT_MISSING on a log
 * that opened without a frozen graph (a pre-v2 record).
 */
export function loadGraphFlow(events: AuditEvent[]): GraphFlow | null {
  const opened = events.find((e) => e.type === 'workflow.opened');
  if (!opened) return null;
  const graph = (opened.payload as Record<string, unknown>).graph as WorkflowGraph | undefined;
  if (!graph)
    fail('GRAPH_SNAPSHOT_MISSING', 'workflow.opened carries no frozen graph (pre-v2 log?)');
  // `fail` returns never but the const-arrow form doesn't narrow here (codebase
  // convention: assert after a fail guard, as commands.ts does).
  const def = compileGraph(graph!);
  const instance = deriveInstance(events, def)!;
  return { graph: graph!, def, instance };
}

/** Convenience: just the derived instance from a v2 log. */
export function deriveInstanceFromLog(events: AuditEvent[]): WorkflowInstance | null {
  return loadGraphFlow(events)?.instance ?? null;
}
