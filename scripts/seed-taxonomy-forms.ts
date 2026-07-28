// Seed the per-category taxonomy forms into nf_form_definitions.
// Usage: `npm run taxonomy:seed`. Idempotent upsert by (key, version).
//
// The forms themselves are the engine's source of truth (engine/intake/forms.ts);
// this script just writes them to the DB. Run with tsx so it can import the
// engine's TypeScript directly.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

import { allCategoryForms } from '../engine/intake/forms';
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
  console.error('✗ DATABASE_URL not set (.env.local).');
  process.exit(1);
}
const urlMatch = raw.match(/postgres(?:ql)?:\/\/[^\s'"]+/);
const sql = neon(urlMatch ? urlMatch[0] : raw.trim());

const forms = allCategoryForms();
// Every form names a workflowKey, and submitForm() refuses to run without that
// definition present — so the flows MUST be seeded alongside the forms or every
// submission fails with WORKFLOW_DEF_NOT_FOUND. Flows are keyed by department,
// so 22 forms need only 6 definitions.
const flows = allDepartmentFlows();

// Fail before writing anything if a form points at a flow we're not seeding.
const flowKeys = new Set(flows.map((f) => f.key));
const orphans = forms.filter((f) => !flowKeys.has(f.workflowKey));
if (orphans.length) {
  console.error(
    `✗ ${orphans.length} form(s) name a workflow with no definition: ` +
      orphans.map((o) => `${o.key}→${o.workflowKey}`).join(', '),
  );
  process.exit(1);
}

// The package is CJS, so the writes live in main() rather than at top level —
// same shape as scripts/seed-demo.ts and scripts/smoke-engine.ts.
async function main(): Promise<void> {
  let forms_ok = 0;
  let flows_ok = 0;
  try {
    // Flows FIRST: a form whose workflow isn't there yet is the failure this
    // whole script exists to prevent.
    for (const flow of flows) {
      await sql`insert into nf_workflow_definitions (key, version, doc) values (${flow.key}, ${flow.version}, ${JSON.stringify(flow)})
                on conflict (key, version) do update set doc = excluded.doc`;
      flows_ok++;
    }
    for (const form of forms) {
      await sql`insert into nf_form_definitions (key, version, doc) values (${form.key}, ${form.version}, ${JSON.stringify(form)})
                on conflict (key, version) do update set doc = excluded.doc`;
      forms_ok++;
    }
    console.log(
      `✓ Seeded ${flows_ok} department flows into nf_workflow_definitions and ${forms_ok} category forms into nf_form_definitions.`,
    );
  } catch (err) {
    console.error(
      `✗ Seed failed after ${flows_ok}/${flows.length} flows, ${forms_ok}/${forms.length} forms:`,
      (err as Error).message,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✗ Seed failed:', err);
  process.exit(1);
});
