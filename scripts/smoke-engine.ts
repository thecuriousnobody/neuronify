// Real-DB integration smoke test for the v2 engine persistence layer.
// Usage: `npm run engine:smoke`  (requires DATABASE_URL in .env.local)
//
// Per the standing rule "integration tests must hit a real database, not mocks",
// this drives the actual engine service through the Neon-backed Repository: it
// seeds the pothole definitions, runs a submit → approve → resubmit → complete
// lifecycle, asserts the re-derived state + timing, then DELETES its own test
// submission (events cascade) so the DB is left as it was found.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { getSql } from '@/lib/db';
import { engineEnv } from '@/lib/engine';
import { submitForm, recordDecision, recordResubmit, getInstanceView } from '@/engine';

function loadEnvLocal() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  let lines: string[] = [];
  try {
    lines = readFileSync(join(root, '.env.local'), 'utf8').split('\n');
  } catch {
    return;
  }
  for (const line of lines) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const form = {
  id: 'form-pothole-smoke', key: 'pothole_report_smoke', title: 'Pothole report', city: 'Peoria, IL',
  version: 1, workflowKey: 'pothole_flow_smoke',
  fields: [
    { key: 'location', label: 'Where is it?', type: 'location', required: true },
    { key: 'photos', label: 'Photo', type: 'attachment', required: true, requiresAttachment: true },
    { key: 'hazard', label: 'Hazard?', type: 'boolean', required: true },
  ],
};
const workflow = {
  id: 'wf-pothole-smoke', key: 'pothole_flow_smoke', title: 'Pothole flow', version: 1,
  steps: [
    { key: 'intake', title: 'Intake', approvals: [{ approver: 'clerk', scope: ['location', 'photos', 'hazard'] }] },
    { key: 'departmental', title: 'Departmental', approvals: [
      { approver: 'public_works', scope: ['location', 'photos'] },
      { approver: 'fire', scope: ['hazard'] },
    ] },
  ],
};

async function main() {
  loadEnvLocal();
  if (!(process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING)) {
    console.error('✗ No DATABASE_URL / POSTGRES_CONNECTION_STRING — skipping engine smoke test.');
    process.exit(1);
  }

  const sql = getSql();
  const env = engineEnv();
  let submissionId: string | null = null;

  try {
    await sql`insert into nf_form_definitions (key, version, doc) values (${form.key}, ${form.version}, ${JSON.stringify(form)})
              on conflict (key, version) do update set doc = excluded.doc`;
    await sql`insert into nf_workflow_definitions (key, version, doc) values (${workflow.key}, ${workflow.version}, ${JSON.stringify(workflow)})
              on conflict (key, version) do update set doc = excluded.doc`;

    const res = await submitForm(env, {
      formKey: 'pothole_report_smoke', city: 'Peoria, IL', source: 'voice',
      values: [{ fieldKey: 'location', value: 'Knoxville & Sheridan' }, { fieldKey: 'hazard', value: true }],
    });
    submissionId = res.submissionId;

    await recordDecision(env, submissionId, { stepKey: 'intake', approver: 'clerk', decision: 'approved' });
    await recordDecision(env, submissionId, { stepKey: 'departmental', approver: 'fire', decision: 'approved' });
    await recordDecision(env, submissionId, { stepKey: 'departmental', approver: 'public_works', decision: 'requires_resubmit', resubmitScope: ['photos'], reason: 'blurry' });

    let view = await getInstanceView(env, submissionId);
    assert.equal(view!.instance.status, 'open');
    assert.equal(view!.instance.steps[1].approvals.find((a) => a.approver === 'fire')!.status, 'approved');
    assert.equal(view!.instance.steps[1].approvals.find((a) => a.approver === 'public_works')!.status, 'awaiting_resubmit');

    await recordResubmit(env, submissionId, { stepKey: 'departmental', approver: 'public_works' });
    await recordDecision(env, submissionId, { stepKey: 'departmental', approver: 'public_works', decision: 'approved' });

    view = await getInstanceView(env, submissionId);
    assert.equal(view!.instance.status, 'completed');
    assert.equal(view!.timing.byApproval['departmental::public_works'].loops, 1);

    const comms = (await sql`select reason from nf_communications where submission_id = ${submissionId} order by created_at`) as any[];
    assert.ok(comms.some((c) => c.reason === 'completed'), 'completion was relayed to the outbox');

    console.log(`✓ engine smoke passed against Neon — submission ${submissionId} round-tripped (${comms.length} comms).`);
  } finally {
    if (submissionId) {
      await sql`delete from nf_submissions where id = ${submissionId}`; // events + comms cascade
      console.log(`  cleaned up test submission ${submissionId}.`);
    }
  }
}

main().catch((err) => {
  console.error('✗ engine smoke failed:', err);
  process.exit(1);
});
