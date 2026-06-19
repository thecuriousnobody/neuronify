// Phase 5 proof: citizen edits a bounced field and resubmits — append-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FormDefinition, WorkflowDefinition } from '../domain/types';
import { submitForm, recordDecision, recordRevisionAndResubmit, loadInstance, getInstanceView } from './service';
import { WorkflowError } from './errors';
import { makeTestEnv } from '../testing/memory';

const form: FormDefinition = {
  id: 'f', key: 'pothole_report', title: 'Pothole', city: 'Peoria, IL', version: 1, workflowKey: 'pothole_flow',
  fields: [
    { key: 'location', label: 'Where?', type: 'text', required: true },
    { key: 'description', label: 'What?', type: 'text', required: true },
    { key: 'hazard', label: 'Hazard?', type: 'boolean', required: true },
  ],
};
const workflow: WorkflowDefinition = {
  id: 'w', key: 'pothole_flow', title: 'Flow', version: 1,
  steps: [
    { key: 'departmental', title: 'Dept', approvals: [
      { approver: 'public_works', scope: ['location', 'description'] },
      { approver: 'fire', scope: ['hazard'] },
    ] },
  ],
};

function seeded() {
  const h = makeTestEnv(0);
  h.repo.putFormDefinition(form);
  h.repo.putWorkflowDefinition(workflow);
  return h;
}
const input = {
  formKey: 'pothole_report', city: 'Peoria, IL', source: 'voice' as const,
  values: [{ fieldKey: 'location', value: 'Main St' }, { fieldKey: 'description', value: 'blurry' }, { fieldKey: 'hazard', value: true }],
};

test('citizen revises a bounced field and resubmits; approval reopens, value updated, history appended', async () => {
  const h = seeded();
  const { env } = h;
  const { submissionId } = await submitForm(env, input);

  await recordDecision(env, submissionId, { stepKey: 'departmental', approver: 'fire', decision: 'approved' });
  await recordDecision(env, submissionId, {
    stepKey: 'departmental', approver: 'public_works', decision: 'requires_resubmit', resubmitScope: ['description'], reason: 'too vague',
  });

  // citizen fixes the description
  await recordRevisionAndResubmit(env, submissionId, [{ fieldKey: 'description', value: 'deep pothole, ~2ft, bent my rim' }]);

  const view = await getInstanceView(env, submissionId);
  const pw = view!.instance.steps[0].approvals.find((a) => a.approver === 'public_works')!;
  const fire = view!.instance.steps[0].approvals.find((a) => a.approver === 'fire')!;
  assert.equal(pw.status, 'pending', 'bounced approval reopened for re-review');
  assert.equal(fire.status, 'approved', 'the other slice stayed locked');

  // materialized value updated
  const sub = await env.repo.getSubmission(submissionId);
  assert.equal(sub!.values.find((v) => v.fieldKey === 'description')!.value, 'deep pothole, ~2ft, bent my rim');

  // append-only: a submission.revised event exists with the old→new change
  const revised = view!.events.find((e) => e.type === 'submission.revised');
  assert.ok(revised, 'revision recorded in the audit log');
  const changes = (revised!.payload as any).changes;
  assert.equal(changes[0].from, 'blurry');
  assert.equal(changes[0].to, 'deep pothole, ~2ft, bent my rim');
});

test('citizen cannot edit a field that was not requested', async () => {
  const h = seeded();
  const { env } = h;
  const { submissionId } = await submitForm(env, input);
  await recordDecision(env, submissionId, { stepKey: 'departmental', approver: 'fire', decision: 'approved' });
  await recordDecision(env, submissionId, {
    stepKey: 'departmental', approver: 'public_works', decision: 'requires_resubmit', resubmitScope: ['description'], reason: 'x',
  });
  await assert.rejects(
    () => recordRevisionAndResubmit(env, submissionId, [{ fieldKey: 'location', value: 'hacked' }]),
    (e: unknown) => e instanceof WorkflowError && e.code === 'RESUBMIT_SCOPE_OUT_OF_BOUNDS',
  );
});
