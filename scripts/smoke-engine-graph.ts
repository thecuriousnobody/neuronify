// Real-DB integration smoke for the v2 GRAPH path. Usage: `npm run engine:smoke:graph`.
//
// Proves the frozen-graph model round-trips through Neon: submitGraph freezes a
// composed pothole graph into the audit log, the workflow is re-derived FROM THE
// LOG ALONE (no nf_workflow_definitions row seeded), a departmental approval
// completes it, and the re-derived state matches. Cleans up after itself.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { getSql } from '@/lib/db';
import { engineEnv } from '@/lib/engine';
import { submitGraph, recordDecision, getInstanceView } from '@/engine';
import type { WorkflowGraph } from '@/engine';

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

// Scenario A: start → intake → public_works_review → notify → done.
const potholeGraph: WorkflowGraph = {
  key: 'pothole_flow',
  title: 'Pothole / road hazard',
  version: 1,
  nodes: [
    { key: 'start', kind: 'start', title: 'Report starts' },
    { key: 'intake', kind: 'intake', title: 'Collect report' },
    {
      key: 'public_works_review',
      kind: 'approval',
      title: 'Public Works review',
      approvals: [{ approver: 'public_works', scope: ['location', 'hazard'] }],
    },
    { key: 'notify', kind: 'notify', title: 'Notify resident' },
    { key: 'done', kind: 'done', title: 'Resolved' },
  ],
  edges: [
    { from: 'start', to: 'intake' },
    { from: 'intake', to: 'public_works_review' },
    { from: 'public_works_review', to: 'notify' },
    { from: 'notify', to: 'done' },
  ],
};

async function main() {
  loadEnvLocal();
  if (!(process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING)) {
    console.error('✗ No DATABASE_URL / POSTGRES_CONNECTION_STRING — skipping graph smoke test.');
    process.exit(1);
  }

  const sql = getSql();
  const env = engineEnv();
  let submissionId: string | null = null;

  try {
    // NOTE: no nf_workflow_definitions seed — the graph is self-describing.
    const res = await submitGraph(env, {
      formKey: 'pothole_report',
      city: 'Peoria, IL',
      source: 'voice',
      values: [
        { fieldKey: 'location', value: 'Main St & 5th Ave' },
        { fieldKey: 'hazard', value: true },
      ],
      graph: potholeGraph,
    });
    submissionId = res.submissionId;

    // The frozen graph is actually in the ledger.
    const openedRows = (await sql`
      select payload from nf_audit_events
      where submission_id = ${submissionId} and type = 'workflow.opened'
    `) as any[];
    assert.ok(openedRows[0]?.payload?.graph, 'graph is frozen into the workflow.opened event');
    assert.equal(openedRows[0].payload.graph.key, 'pothole_flow');

    // Re-derived from the log alone: the review step is open.
    let view = await getInstanceView(env, submissionId);
    assert.equal(view!.instance.status, 'open');
    assert.equal(view!.instance.steps.length, 1, 'only the approval node is an executable step');
    assert.equal(view!.instance.steps[0].stepKey, 'public_works_review');
    assert.equal(view!.instance.steps[0].status, 'open');

    // Public Works approves → step closes → workflow completes.
    await recordDecision(env, submissionId, {
      stepKey: 'public_works_review',
      approver: 'public_works',
      decision: 'approved',
    });

    view = await getInstanceView(env, submissionId);
    assert.equal(view!.instance.status, 'completed');
    assert.equal(view!.instance.steps[0].status, 'closed');

    const comms = (await sql`select reason from nf_communications where submission_id = ${submissionId} order by created_at`) as any[];
    assert.ok(comms.some((c) => c.reason === 'submitted'), 'receipt was relayed');
    assert.ok(comms.some((c) => c.reason === 'completed'), 'completion was relayed');

    console.log(`✓ graph smoke passed against Neon — submission ${submissionId} round-tripped from a frozen graph (${comms.length} comms).`);
  } finally {
    if (submissionId) {
      await sql`delete from nf_submissions where id = ${submissionId}`; // events + comms cascade
      console.log(`  cleaned up test submission ${submissionId}.`);
    }
  }
}

main().catch((err) => {
  console.error('✗ graph smoke failed:', err);
  process.exit(1);
});
