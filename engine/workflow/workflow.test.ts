// Phase 1 core proof. Run: `npm test`.
//
// Exercises the founding sketch as executable rules against a two-step pothole
// workflow: a single-clerk intake step, then a two-department review step
// (public_works + fire) that is a parallel AND-gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Submission, WorkflowDefinition } from '../domain/types';
import { startWorkflow, decide, fulfillResubmit } from './commands';
import { deriveInstance } from './state';
import { computeTiming } from '../timing/index';
import { WorkflowError } from './errors';
import { FakeClock, SeqIds } from '../testing/doubles';

const def: WorkflowDefinition = {
  id: 'wf-pothole',
  key: 'pothole_flow',
  title: 'Pothole report flow',
  version: 1,
  steps: [
    { key: 'intake', title: 'Intake review', approvals: [{ approver: 'clerk', scope: ['location', 'photos', 'hazard'] }] },
    {
      key: 'departmental',
      title: 'Departmental review',
      approvals: [
        { approver: 'public_works', scope: ['location', 'photos'] },
        { approver: 'fire', scope: ['hazard'] },
      ],
    },
  ],
};

const submission: Submission = {
  id: 'sub-1',
  formKey: 'pothole_report',
  formVersion: 1,
  city: 'Peoria, IL',
  submittedAt: new Date(0).toISOString(),
  values: [],
  source: 'voice',
};

/** Build a fresh ctx + an append-only log + a re-derive helper. */
function harness() {
  const clock = new FakeClock(0);
  const ctx = { clock, ids: new SeqIds('e') };
  const log: import('../domain/types').AuditEvent[] = [];
  const apply = (r: { events: import('../domain/types').AuditEvent[] }) => log.push(...r.events);
  const state = () => deriveInstance(log, def)!;
  return { clock, ctx, log, apply, state };
}

test('happy path: sequential steps, parallel AND-gate, completes', () => {
  const h = harness();
  const start = startWorkflow(submission, def, h.ctx);
  h.apply(start);

  let inst = h.state();
  assert.equal(inst.status, 'open');
  assert.equal(inst.steps[0].status, 'open', 'intake opens immediately');
  assert.equal(inst.steps[1].status, 'not_started', 'departmental waits its turn');

  // clerk approves -> intake closes, departmental opens
  h.clock.advance(60_000);
  h.apply(decide(h.state(), def, { stepKey: 'intake', approver: 'clerk', decision: 'approved' }, h.ctx));
  inst = h.state();
  assert.equal(inst.steps[0].status, 'closed');
  assert.equal(inst.steps[1].status, 'open');

  // fire approves its slice; workflow still open (public_works pending) — the gate
  h.clock.advance(30_000);
  h.apply(decide(h.state(), def, { stepKey: 'departmental', approver: 'fire', decision: 'approved' }, h.ctx));
  inst = h.state();
  assert.equal(inst.status, 'open', 'one approval does not close the step');
  assert.equal(inst.steps[1].status, 'open');

  // public_works approves -> step closes, no next step -> workflow completed
  h.clock.advance(20_000);
  h.apply(decide(h.state(), def, { stepKey: 'departmental', approver: 'public_works', decision: 'approved' }, h.ctx));
  inst = h.state();
  assert.equal(inst.steps[1].status, 'closed');
  assert.equal(inst.status, 'completed');
});

test('sequential gate: cannot act on a step that has not opened', () => {
  const h = harness();
  h.apply(startWorkflow(submission, def, h.ctx));
  assert.throws(
    () => decide(h.state(), def, { stepKey: 'departmental', approver: 'fire', decision: 'approved' }, h.ctx),
    (e: unknown) => e instanceof WorkflowError && e.code === 'STEP_NOT_OPEN',
  );
});

test('portion-locked + captured once: resubmit bounces one slice, others stay frozen', () => {
  const h = harness();
  h.apply(startWorkflow(submission, def, h.ctx));
  h.apply(decide(h.state(), def, { stepKey: 'intake', approver: 'clerk', decision: 'approved' }, h.ctx));

  // fire approves; public_works bounces only "photos"
  h.apply(decide(h.state(), def, { stepKey: 'departmental', approver: 'fire', decision: 'approved' }, h.ctx));
  const bounce = decide(
    h.state(),
    def,
    { stepKey: 'departmental', approver: 'public_works', decision: 'requires_resubmit', resubmitScope: ['photos'], reason: 'photo too blurry' },
    h.ctx,
  );
  h.apply(bounce);

  let inst = h.state();
  const fire = inst.steps[1].approvals.find((a) => a.approver === 'fire')!;
  const pw = inst.steps[1].approvals.find((a) => a.approver === 'public_works')!;
  assert.equal(fire.status, 'approved', 'fire stays locked while PW loops');
  assert.equal(pw.status, 'awaiting_resubmit');
  assert.deepEqual(pw.resubmitScope, ['photos']);
  assert.equal(inst.status, 'open', 'step does not advance with a bounced slice');
  // a resubmit relays to the submitter
  assert.equal(bounce.communications.at(-1)?.reason, 'requires_resubmit');

  // captured once: fire cannot be re-decided
  assert.throws(
    () => decide(h.state(), def, { stepKey: 'departmental', approver: 'fire', decision: 'approved' }, h.ctx),
    (e: unknown) => e instanceof WorkflowError && e.code === 'APPROVAL_NOT_PENDING',
  );

  // citizen returns the portion -> only PW reopens, fire still locked
  h.apply(fulfillResubmit(h.state(), { stepKey: 'departmental', approver: 'public_works' }, h.ctx));
  inst = h.state();
  assert.equal(inst.steps[1].approvals.find((a) => a.approver === 'public_works')!.status, 'pending');
  assert.equal(inst.steps[1].approvals.find((a) => a.approver === 'public_works')!.loops, 1);
  assert.equal(inst.steps[1].approvals.find((a) => a.approver === 'fire')!.status, 'approved');

  // PW approves -> now the gate closes, workflow completes
  h.apply(decide(h.state(), def, { stepKey: 'departmental', approver: 'public_works', decision: 'approved' }, h.ctx));
  assert.equal(h.state().status, 'completed');
});

test('resubmit scope cannot exceed the department portion', () => {
  const h = harness();
  h.apply(startWorkflow(submission, def, h.ctx));
  h.apply(decide(h.state(), def, { stepKey: 'intake', approver: 'clerk', decision: 'approved' }, h.ctx));
  assert.throws(
    () =>
      decide(
        h.state(),
        def,
        { stepKey: 'departmental', approver: 'public_works', decision: 'requires_resubmit', resubmitScope: ['hazard'] },
        h.ctx,
      ),
    (e: unknown) => e instanceof WorkflowError && e.code === 'RESUBMIT_SCOPE_OUT_OF_BOUNDS',
  );
});

test('denial is terminal and requires a reason', () => {
  const h = harness();
  h.apply(startWorkflow(submission, def, h.ctx));
  h.apply(decide(h.state(), def, { stepKey: 'intake', approver: 'clerk', decision: 'approved' }, h.ctx));
  h.apply(decide(h.state(), def, { stepKey: 'departmental', approver: 'fire', decision: 'approved' }, h.ctx));

  // no reason -> rejected, no events emitted
  assert.throws(
    () => decide(h.state(), def, { stepKey: 'departmental', approver: 'public_works', decision: 'denied' }, h.ctx),
    (e: unknown) => e instanceof WorkflowError && e.code === 'REASON_REQUIRED',
  );

  // with a reason -> workflow denied, reason recorded + relayed, fire stays approved
  const denial = decide(
    h.state(),
    def,
    { stepKey: 'departmental', approver: 'public_works', decision: 'denied', reason: 'not city property' },
    h.ctx,
  );
  h.apply(denial);
  const inst = h.state();
  assert.equal(inst.status, 'denied');
  assert.equal(inst.steps[1].status, 'denied');
  assert.equal(inst.steps[1].approvals.find((a) => a.approver === 'fire')!.status, 'approved');
  const comm = denial.communications.at(-1)!;
  assert.equal(comm.reason, 'denied');
  assert.match(comm.message, /not city property/);
});

test('timing splits internal (city) vs external (citizen) from the log', () => {
  const h = harness();
  h.apply(startWorkflow(submission, def, h.ctx)); // t=0

  h.clock.advance(60_000); // t=60s
  h.apply(decide(h.state(), def, { stepKey: 'intake', approver: 'clerk', decision: 'approved' }, h.ctx));

  h.clock.advance(30_000); // t=90s
  h.apply(decide(h.state(), def, { stepKey: 'departmental', approver: 'fire', decision: 'approved' }, h.ctx));

  h.clock.advance(10_000); // t=100s — PW bounces photos
  h.apply(
    decide(h.state(), def, { stepKey: 'departmental', approver: 'public_works', decision: 'requires_resubmit', resubmitScope: ['photos'] }, h.ctx),
  );

  h.clock.advance(120_000); // t=220s — citizen returns it (this 120s is EXTERNAL)
  h.apply(fulfillResubmit(h.state(), { stepKey: 'departmental', approver: 'public_works' }, h.ctx));

  h.clock.advance(15_000); // t=235s — PW approves, workflow completes
  h.apply(decide(h.state(), def, { stepKey: 'departmental', approver: 'public_works', decision: 'approved' }, h.ctx));

  const t = computeTiming(h.log);
  // internal: clerk 60 + fire 30 + PW (40 before bounce + 15 after return) = 145s
  assert.equal(t.internalMs, 145_000);
  // external: PW awaiting resubmit 120s
  assert.equal(t.externalMs, 120_000);

  const pw = t.byApproval['departmental::public_works'];
  assert.equal(pw.externalMs, 120_000);
  assert.equal(pw.internalMs, 55_000);
  assert.equal(pw.loops, 1);
  assert.equal(t.byApproval['departmental::fire'].externalMs, 0);
});

test('audit log is append-only: deriving never mutates events', () => {
  const h = harness();
  h.apply(startWorkflow(submission, def, h.ctx));
  const before = JSON.stringify(h.log);
  deriveInstance(h.log, def);
  deriveInstance(h.log, def);
  assert.equal(JSON.stringify(h.log), before, 'log unchanged by derivation');
});
