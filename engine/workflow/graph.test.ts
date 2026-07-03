// M1 proof: a COMPOSED graph, FROZEN into the log, drives the existing engine.
//
// The graph is the v2 "dynamic entity" — composed per issue, frozen at launch.
// These tests prove: (1) it compiles to executable steps, (2) the frozen graph
// rides in workflow.opened, (3) state re-derives from the LOG ALONE (no external
// definition), and (4) branch/condition graphs fail loudly (scenario B boundary).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AuditEvent, Submission } from '../domain/types';
import type { WorkflowGraph } from '../domain/graph';
import { compileGraph, startGraphWorkflow, loadGraphFlow, deriveInstanceFromLog } from './graph';
import { decide } from './commands';
import { WorkflowError } from './errors';
import { FakeClock, SeqIds } from '../testing/doubles';

// Scenario A: start → intake → public_works_review → notify → done (linear).
const potholeGraph: WorkflowGraph = {
  key: 'pothole_flow',
  title: 'Pothole / road hazard',
  version: 1,
  nodes: [
    { key: 'start', kind: 'start', title: 'Report starts', layout: { x: 24, y: 250 } },
    { key: 'intake', kind: 'intake', title: 'Collect report', layout: { x: 196, y: 250 } },
    {
      key: 'public_works_review',
      kind: 'approval',
      title: 'Public Works review',
      approvals: [{ approver: 'public_works', scope: ['location', 'photos', 'hazard'] }],
      layout: { x: 404, y: 250 },
    },
    { key: 'notify', kind: 'notify', title: 'Notify resident', layout: { x: 612, y: 250 } },
    { key: 'done', kind: 'done', title: 'Resolved', layout: { x: 784, y: 250 } },
  ],
  edges: [
    { from: 'start', to: 'intake' },
    { from: 'intake', to: 'public_works_review' },
    { from: 'public_works_review', to: 'notify' },
    { from: 'notify', to: 'done' },
  ],
};

const submission: Submission = {
  id: 'sub-1',
  formKey: 'pothole_report',
  formVersion: 1,
  city: 'Peoria, IL',
  submittedAt: new Date(0).toISOString(),
  values: [
    { fieldKey: 'location', value: 'Main St & 5th Ave' },
    { fieldKey: 'hazard', value: 'deep pothole, full lane' },
  ],
  source: 'voice',
};

test('compileGraph: linear graph → one approval step, presentational nodes dropped', () => {
  const def = compileGraph(potholeGraph);
  assert.equal(def.key, 'pothole_flow');
  assert.equal(def.steps.length, 1, 'only the approval node becomes a step');
  assert.equal(def.steps[0].key, 'public_works_review');
  assert.deepEqual(def.steps[0].approvals[0].scope, ['location', 'photos', 'hazard']);
});

test('freeze + derive-from-log: pothole folds open → approve → complete, no external def', () => {
  const clock = new FakeClock(0);
  const ctx = { clock, ids: new SeqIds('e') };
  const log: AuditEvent[] = [];

  const start = startGraphWorkflow(submission, potholeGraph, ctx);
  log.push(...start.events);

  // (2) the composed graph is frozen into workflow.opened.
  const opened = log.find((e) => e.type === 'workflow.opened')!;
  assert.ok(opened.payload.graph, 'graph is frozen in the opened event');
  assert.equal((opened.payload.graph as WorkflowGraph).key, 'pothole_flow');

  // (3) state comes from the LOG ALONE.
  let flow = loadGraphFlow(log)!;
  assert.equal(flow.instance.status, 'open');
  assert.equal(flow.instance.steps[0].status, 'open', 'the review step opens immediately');
  assert.equal(start.communications.at(-1)?.reason, 'submitted');

  // public_works approves its portion → step closes → no next → workflow completes.
  clock.advance(3_600_000);
  const approve = decide(
    flow.instance,
    flow.def,
    { stepKey: 'public_works_review', approver: 'public_works', decision: 'approved' },
    ctx,
  );
  log.push(...approve.events);

  flow = loadGraphFlow(log)!;
  assert.equal(flow.instance.steps[0].status, 'closed');
  assert.equal(flow.instance.status, 'completed');
  assert.equal(approve.communications.at(-1)?.reason, 'completed');
});

test('deriveInstanceFromLog returns null before the workflow opens', () => {
  assert.equal(deriveInstanceFromLog([]), null);
});

test('loadGraphFlow throws on a log that opened without a frozen graph (pre-v2)', () => {
  const preV2Log: AuditEvent[] = [
    {
      id: 'e-1',
      submissionId: 'sub-1',
      workflowInstanceId: 'w-1',
      type: 'workflow.opened',
      actor: 'system',
      actorSide: 'system',
      at: new Date(0).toISOString(),
      payload: { workflowKey: 'pothole_flow', workflowVersion: 1 }, // no graph
    },
  ];
  assert.throws(
    () => loadGraphFlow(preV2Log),
    (e: unknown) => e instanceof WorkflowError && e.code === 'GRAPH_SNAPSHOT_MISSING',
  );
});

test('branching is a loud scenario-B boundary, not a silent mis-execution', () => {
  const branching: WorkflowGraph = {
    key: 'permit_flow',
    title: 'Permit with a branch',
    version: 1,
    nodes: [
      { key: 'start', kind: 'start', title: 'start' },
      { key: 'cond', kind: 'condition', title: 'In historic district?', condition: { description: 'parcel in historic overlay' } },
      { key: 'done', kind: 'done', title: 'done' },
    ],
    edges: [
      { from: 'start', to: 'cond' },
      { from: 'cond', to: 'done', when: 'if not' },
    ],
  };
  assert.throws(
    () => compileGraph(branching),
    (e: unknown) => e instanceof WorkflowError && e.code === 'GRAPH_BRANCHING_NOT_SUPPORTED',
  );
});

test('malformed graph: dangling edge is rejected', () => {
  const bad: WorkflowGraph = {
    key: 'bad',
    title: 'bad',
    version: 1,
    nodes: [{ key: 'start', kind: 'start', title: 'start' }],
    edges: [{ from: 'start', to: 'ghost' }],
  };
  assert.throws(
    () => compileGraph(bad),
    (e: unknown) => e instanceof WorkflowError && e.code === 'GRAPH_INVALID',
  );
});
