// Demo-data seeder for the Distillery Labs walkthrough. Usage: `npm run demo:seed`.
//
// Paints the surfaces so the demo starts alive, not empty:
//   - 3 pending resident drops in the /desk/intake queue (varied issues; one with
//     an SMS opt-in so the relay path shows),
//   - 1 launched workflow sitting IN REVIEW in the Public Works /desk queue,
//   - 1 COMPLETED workflow so /track and timing have a finished story.
// Idempotent-ish: tags its rows with [demo] and clears previously seeded ones first.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

const PENDING = [
  {
    transcript:
      "There's a deep pothole at the junction of Knoxville Avenue and Giles Avenue. It's taking up the whole right lane and cars keep swerving around it. Definitely a safety hazard. [demo]",
    phone: null,
  },
  {
    transcript:
      'The streetlight at Sheridan Road and McClure Avenue has been out for over a week — the whole corner is pitch dark at night and people walk there. [demo]',
    phone: '3095550142',
  },
  {
    transcript:
      'The pedestrian crosswalk sign at Fulton Street and Southwest Washington, right by the Caterpillar Visitor Center, is too small — drivers never stop even though state law says they have to. [demo]',
    phone: null,
  },
];

function demoGraph(dept: string, scope: string[]) {
  const review = 'departmental_review';
  return {
    key: 'pothole_report_flow',
    title: `Pothole Report — ${dept}`,
    version: 1,
    nodes: [
      { key: 'start', kind: 'start', title: 'Report starts', layout: { x: 24, y: 250 } },
      { key: 'intake', kind: 'intake', title: 'Collect report', layout: { x: 236, y: 250 } },
      {
        key: review,
        kind: 'approval',
        title: 'Public Works review',
        approvals: [{ approver: dept, scope }],
        note: 'Seeded for the demo walkthrough. [demo]',
        layout: { x: 448, y: 250 },
      },
      { key: 'notify', kind: 'notify', title: 'Notify resident', layout: { x: 660, y: 250 } },
      { key: 'done', kind: 'done', title: 'Resolved', layout: { x: 872, y: 250 } },
    ],
    edges: [
      { from: 'start', to: 'intake' },
      { from: 'intake', to: review },
      { from: review, to: 'notify' },
      { from: 'notify', to: 'done' },
    ],
  };
}

async function main() {
  loadEnvLocal();
  const { getSql } = await import('@/lib/db');
  const { engineEnv } = await import('@/lib/engine');
  const { submitGraph, recordDecision } = await import('@/engine');
  const sql = getSql();
  const env = engineEnv();

  // Clear prior demo rows (submissions cascade events/comms/contacts).
  const oldPending = (await sql`delete from nf_pending_intakes where transcript like '%[demo]%' returning id`) as any[];
  const oldSubs = (await sql`
    select distinct e.submission_id as id from nf_audit_events e
    where e.type = 'workflow.opened' and e.payload->'graph'->'nodes' @> '[{"note":"Seeded for the demo walkthrough. [demo]"}]'
  `) as any[];
  for (const r of oldSubs) await sql`delete from nf_submissions where id = ${r.id}`;
  console.log(`cleared ${oldPending.length} demo pendings, ${oldSubs.length} demo submissions.`);

  // 1) Pending drops for the intake queue.
  const { createPending } = await import('@/lib/pending');
  for (const p of PENDING) {
    await createPending({ formKey: 'pothole_report', city: 'Peoria, IL', transcript: p.transcript, source: 'voice', phone: p.phone });
  }
  console.log(`seeded ${PENDING.length} pending drops → /desk/intake queue.`);

  // 2) One live workflow in review (Public Works queue).
  const inReview = await submitGraph(env, {
    formKey: 'pothole_report',
    city: 'Peoria, IL',
    source: 'voice',
    values: [
      { fieldKey: 'location', value: 'War Memorial Dr & Sterling Ave' },
      { fieldKey: 'description', value: 'Pothole cluster in the eastbound lane near the mall entrance. [demo]' },
      { fieldKey: 'hazard', value: true },
    ],
    graph: demoGraph('public_works', ['location', 'description', 'hazard']) as any,
    launchedBy: 'clerk',
  });
  console.log(`seeded IN-REVIEW submission ${inReview.submissionId} → /desk (public_works) + /track/${inReview.submissionId}`);

  // 3) One completed workflow (finished story for /track + timing).
  const done = await submitGraph(env, {
    formKey: 'pothole_report',
    city: 'Peoria, IL',
    source: 'voice',
    values: [
      { fieldKey: 'location', value: 'N University St & W Main St' },
      { fieldKey: 'description', value: 'Broken curb section kicked into the bike lane. [demo]' },
      { fieldKey: 'hazard', value: false },
    ],
    graph: demoGraph('public_works', ['location', 'description', 'hazard']) as any,
    launchedBy: 'clerk',
  });
  await recordDecision(env, done.submissionId, {
    stepKey: 'departmental_review',
    approver: 'public_works',
    decision: 'approved',
  });
  console.log(`seeded COMPLETED submission ${done.submissionId} → /track/${done.submissionId}`);

  console.log('\nDemo surfaces ready:');
  console.log('  /desk/intake  — 3 drops waiting for review');
  console.log('  /desk         — 1 report awaiting Public Works');
  console.log(`  /track/${done.submissionId.slice(0, 8)}… — a completed journey`);
}

main().catch((err) => {
  console.error('✗ demo seed failed:', err);
  process.exit(1);
});
