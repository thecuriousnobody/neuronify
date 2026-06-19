// Phase 5 proof: operator metrics aggregate correctly across submissions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FormDefinition, WorkflowDefinition } from '../domain/types';
import { submitForm, recordDecision, computeMetrics } from './service';
import { makeTestEnv } from '../testing/memory';

const form: FormDefinition = {
  id: 'f', key: 'pothole_report', title: 'Pothole', city: 'Peoria, IL', version: 1, workflowKey: 'pothole_flow',
  fields: [{ key: 'location', label: 'Where?', type: 'text', required: true }],
};
const workflow: WorkflowDefinition = {
  id: 'w', key: 'pothole_flow', title: 'Flow', version: 1,
  steps: [
    { key: 'intake', title: 'Intake', approvals: [{ approver: 'clerk', scope: ['location'] }] },
    { key: 'departmental', title: 'Dept', approvals: [
      { approver: 'public_works', scope: ['location'] },
      { approver: 'fire', scope: ['location'] },
    ] },
  ],
};

function seeded() {
  const h = makeTestEnv(0);
  h.repo.putFormDefinition(form);
  h.repo.putWorkflowDefinition(workflow);
  return h;
}
const input = { formKey: 'pothole_report', city: 'Peoria, IL', source: 'voice' as const, values: [{ fieldKey: 'location', value: 'A' }] };

test('metrics aggregate status, timing, resubmits, and pending load', async () => {
  const h = seeded();
  const { env } = h;

  // Submission 1: complete it (clerk → fire → public_works)
  const a = await submitForm(env, input);
  h.clock.advance(60_000);
  await recordDecision(env, a.submissionId, { stepKey: 'intake', approver: 'clerk', decision: 'approved' });
  await recordDecision(env, a.submissionId, { stepKey: 'departmental', approver: 'fire', decision: 'approved' });
  await recordDecision(env, a.submissionId, { stepKey: 'departmental', approver: 'public_works', decision: 'approved' });

  // Submission 2: bounce it once, leave open at departmental (public_works pending)
  const b = await submitForm(env, input);
  await recordDecision(env, b.submissionId, { stepKey: 'intake', approver: 'clerk', decision: 'approved' });
  await recordDecision(env, b.submissionId, { stepKey: 'departmental', approver: 'public_works', decision: 'requires_resubmit', resubmitScope: ['location'], reason: 'x' });

  const m = await computeMetrics(env);
  assert.equal(m.total, 2);
  assert.equal(m.byStatus.completed, 1);
  assert.equal(m.byStatus.open, 1);
  assert.equal(m.byStatus.denied, 0);
  assert.equal(m.resubmitRequests, 1);
  assert.equal(m.resubmitRate, 0.5, 'one of two submissions hit a resubmit');
  assert.ok(m.internalMs > 0, 'accrued city time');
  // submission 2 is open at departmental: public_works awaiting_resubmit (not pending), fire pending
  const fire = m.pendingByDepartment.find((p) => p.approver === 'fire');
  assert.equal(fire?.count, 1, 'fire is the pending department on the open submission');
});
