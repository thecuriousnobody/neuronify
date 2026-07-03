// Phase 2 proof: the async service layer round-trips through a real (in-memory)
// Repository. Every read re-derives state from the persisted event log — there
// is no stored instance — so this also proves reconstruction is faithful.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FormDefinition, WorkflowDefinition } from '../domain/types';
import { getInstanceView, recordDecision, recordResubmit, submitForm } from './service';
import { WorkflowError } from './errors';
import { makeTestEnv } from '../testing/memory';

const form: FormDefinition = {
  id: 'form-pothole',
  key: 'pothole_report',
  title: 'Pothole report',
  city: 'Peoria, IL',
  version: 1,
  workflowKey: 'pothole_flow',
  fields: [
    { key: 'location', label: 'Where is it?', type: 'location', required: true },
    { key: 'photos', label: 'Photo', type: 'attachment', required: true, requiresAttachment: true },
    { key: 'hazard', label: 'Is it a hazard?', type: 'boolean', required: true },
  ],
};

const workflow: WorkflowDefinition = {
  id: 'wf-pothole',
  key: 'pothole_flow',
  title: 'Pothole flow',
  version: 1,
  steps: [
    { key: 'intake', title: 'Intake', approvals: [{ approver: 'clerk', scope: ['location', 'photos', 'hazard'] }] },
    {
      key: 'departmental',
      title: 'Departmental',
      approvals: [
        { approver: 'public_works', scope: ['location', 'photos'] },
        { approver: 'fire', scope: ['hazard'] },
      ],
    },
  ],
};

function seeded(startMs = 0) {
  const h = makeTestEnv(startMs);
  h.repo.putFormDefinition(form);
  h.repo.putWorkflowDefinition(workflow);
  return h;
}

const submitInput = {
  formKey: 'pothole_report',
  city: 'Peoria, IL',
  source: 'voice' as const,
  values: [
    { fieldKey: 'location', value: 'Knoxville & Sheridan' },
    { fieldKey: 'hazard', value: true },
  ],
};

test('submitForm persists the Record of Truth and opens the workflow', async () => {
  const { env, repo, notifier } = seeded();
  const { submissionId, instanceId } = await submitForm(env, submitInput);

  const saved = await repo.getSubmission(submissionId);
  assert.ok(saved, 'submission persisted');
  assert.equal(saved!.formVersion, 1, 'form version stamped from the definition');

  const view = await getInstanceView(env, submissionId);
  assert.equal(view!.instance.id, instanceId);
  assert.equal(view!.instance.steps[0].status, 'open');
  assert.equal(view!.instance.steps[1].status, 'not_started');
  assert.equal(notifier.sent.at(-1)?.reason, 'submitted');
});

test('full lifecycle round-trips through persistence with a resubmit loop', async () => {
  const h = seeded(0);
  const { env } = h;
  const { submissionId } = await submitForm(env, submitInput);

  h.clock.advance(60_000);
  await recordDecision(env, submissionId, { stepKey: 'intake', approver: 'clerk', decision: 'approved' });

  h.clock.advance(30_000);
  await recordDecision(env, submissionId, { stepKey: 'departmental', approver: 'fire', decision: 'approved' });

  h.clock.advance(10_000);
  await recordDecision(env, submissionId, {
    stepKey: 'departmental',
    approver: 'public_works',
    decision: 'requires_resubmit',
    resubmitScope: ['photos'],
    reason: 'blurry',
  });

  // reload from the log: fire frozen, PW awaiting, still open
  let view = await getInstanceView(env, submissionId);
  assert.equal(view!.instance.steps[1].approvals.find((a) => a.approver === 'fire')!.status, 'approved');
  assert.equal(view!.instance.steps[1].approvals.find((a) => a.approver === 'public_works')!.status, 'awaiting_resubmit');
  assert.equal(view!.instance.status, 'open');
  assert.equal(h.notifier.sent.at(-1)?.reason, 'requires_resubmit');

  h.clock.advance(120_000);
  await recordResubmit(env, submissionId, { stepKey: 'departmental', approver: 'public_works' });

  h.clock.advance(15_000);
  await recordDecision(env, submissionId, { stepKey: 'departmental', approver: 'public_works', decision: 'approved' });

  view = await getInstanceView(env, submissionId);
  assert.equal(view!.instance.status, 'completed');
  assert.equal(view!.timing.internalMs, 145_000);
  assert.equal(view!.timing.externalMs, 120_000);
  assert.equal(view!.timing.byApproval['departmental::public_works'].loops, 1);
  assert.equal(h.notifier.sent.at(-1)?.reason, 'completed');
});

test('comms cadence: one message per step/box, not per department', async () => {
  const h = seeded();
  const { env } = h;
  const { submissionId } = await submitForm(env, submitInput);

  // intake step: single clerk -> closing it sends exactly one step message
  await recordDecision(env, submissionId, { stepKey: 'intake', approver: 'clerk', decision: 'approved' });
  // departmental box: fire approves first -> SILENT (box not closed yet)
  const beforeLast = h.notifier.sent.length;
  await recordDecision(env, submissionId, { stepKey: 'departmental', approver: 'fire', decision: 'approved' });
  assert.equal(h.notifier.sent.length, beforeLast, 'first department approval sends nothing');
  // public_works approves -> box closes (final) -> one terminal message
  await recordDecision(env, submissionId, { stepKey: 'departmental', approver: 'public_works', decision: 'approved' });

  // The RESIDENT cadence: received, one per box, terminal — never one per department.
  const residentReasons = h.notifier.sent.filter((c) => c.to === 'submitter').map((c) => c.reason);
  assert.deepEqual(residentReasons, ['submitted', 'step_completed', 'completed'], 'received, one per box, terminal');

  // Departments get action nudges when their step OPENS (not on each approval):
  // clerk at start, then fire + public_works when the departmental box opens.
  const nudges = h.notifier.sent.filter((c) => c.reason === 'dept_action_required').map((c) => c.to);
  assert.deepEqual(nudges, ['department:clerk', 'department:public_works', 'department:fire']);
});

test('submitForm fails closed when the form definition is missing', async () => {
  const { env } = makeTestEnv(); // nothing seeded
  await assert.rejects(
    () => submitForm(env, submitInput),
    (e: unknown) => e instanceof WorkflowError && e.code === 'FORM_NOT_FOUND',
  );
});

test('acting on an unknown submission fails closed', async () => {
  const { env } = seeded();
  await assert.rejects(
    () => recordDecision(env, 'nope', { stepKey: 'intake', approver: 'clerk', decision: 'approved' }),
    (e: unknown) => e instanceof WorkflowError && e.code === 'INSTANCE_NOT_FOUND',
  );
});
