// One-off cleanup: remove the `<category>_report` form rows written by an
// accidental run of taxonomy:seed before the taxonomy forms were moved into
// their own `intake_` namespace.
//
// Usage:
//   npm run taxonomy:cleanup            → DRY RUN, prints what it would delete
//   npm run taxonomy:cleanup -- --confirm  → actually deletes
//
// Two guards, because this is the only destructive script in the repo and it
// runs against the shared prod database:
//
//   1. It will only consider keys of the exact shape `<category>_report` for a
//      known taxonomy category — never a pattern match, never a LIKE.
//   2. It will only delete a row whose doc.workflowKey is one of the DEPARTMENT
//      flows. That is the fingerprint of the accidental seed. v1's own
//      pothole_report points at `pothole_flow`, so a restored v1 row is skipped
//      even though its key matches the shape.
//
// `pothole_report` is v1's key and is excluded outright — belt and braces.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

import { CATEGORIES } from '../engine/intake/taxonomy';
import { allDepartmentFlows } from '../engine/intake/flows';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file: string): void {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv(join(root, '.env.local'));

const raw = process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING;
if (!raw) {
  console.error('✗ No DATABASE_URL / POSTGRES_CONNECTION_STRING (.env.local).');
  process.exit(1);
}
const urlMatch = raw.match(/postgres(?:ql)?:\/\/[^\s'"]+/);
const sql = neon(urlMatch ? urlMatch[0] : raw.trim());

const confirmed = process.argv.includes('--confirm');

/** v1 owns this key. Never touch it. */
const V1_KEYS = new Set(['pothole_report', 'pothole_report_smoke']);

const candidates = CATEGORIES.map((c) => `${c.key}_report`).filter((k) => !V1_KEYS.has(k));
const departmentFlowKeys = new Set(allDepartmentFlows().map((f) => f.key));

async function main(): Promise<void> {
  const host = (urlMatch ? urlMatch[0] : raw!).match(/@([^/?:]+)/)?.[1] ?? '(unknown)';
  console.log(`${confirmed ? 'DELETING from' : 'DRY RUN against'} ${host}\n`);

  const doomed: string[] = [];
  const skipped: string[] = [];

  for (const key of candidates) {
    const rows = (await sql`select key, doc from nf_form_definitions where key = ${key}`) as any[];
    if (!rows.length) continue;
    for (const row of rows) {
      const wf = row.doc?.workflowKey;
      if (departmentFlowKeys.has(wf)) doomed.push(key);
      else skipped.push(`${key} (workflowKey=${wf} — not from the accidental seed)`);
    }
  }

  if (skipped.length) {
    console.log('SKIPPING (failed the fingerprint check):');
    for (const s of skipped) console.log('   ', s);
    console.log('');
  }

  if (!doomed.length) {
    console.log('Nothing to delete — the stale rows are already gone.');
    return;
  }

  console.log(`${doomed.length} stale row(s)${confirmed ? ' being deleted' : ' would be deleted'}:`);
  for (const d of doomed) console.log('   ', d);

  if (!confirmed) {
    console.log('\nDry run — nothing was changed. Re-run with `-- --confirm` to delete.');
    return;
  }

  let deleted = 0;
  for (const key of doomed) {
    await sql`delete from nf_form_definitions where key = ${key}`;
    deleted++;
  }
  console.log(`\n✓ Deleted ${deleted} stale form definition(s).`);
}

main().catch((err) => {
  console.error('✗ Cleanup failed:', err);
  process.exit(1);
});
