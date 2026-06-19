// Seed v2 engine definitions (a Pothole report form + its 2-step workflow).
// Usage: `npm run engine:seed`. Idempotent upsert by (key, version).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
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

const form = {
  id: 'form-pothole',
  key: 'pothole_report',
  title: 'Pothole report',
  city: 'Peoria, IL',
  version: 1,
  workflowKey: 'pothole_flow',
  fields: [
    { key: 'location', label: 'Where is the pothole?', type: 'text', required: true, prompt: 'the street and nearest cross-street or landmark' },
    { key: 'description', label: 'What’s wrong?', type: 'longtext', required: true, prompt: 'how big it is and what it’s affecting' },
    { key: 'hazard', label: 'Is it a safety hazard?', type: 'boolean', required: true, prompt: 'whether it’s dangerous to drive or walk over' },
    { key: 'photo', label: 'A photo of the pothole', type: 'attachment', required: false, requiresAttachment: true },
  ],
};

const workflow = {
  id: 'wf-pothole',
  key: 'pothole_flow',
  title: 'Pothole flow',
  version: 1,
  steps: [
    { key: 'intake', title: 'Intake review', approvals: [{ approver: 'clerk', scope: ['location', 'description', 'hazard', 'photo'] }] },
    {
      key: 'departmental',
      title: 'Departmental review',
      approvals: [
        { approver: 'public_works', scope: ['location', 'description', 'photo'] },
        { approver: 'fire', scope: ['hazard'] },
      ],
    },
  ],
};

try {
  await sql`insert into nf_form_definitions (key, version, doc) values (${form.key}, ${form.version}, ${JSON.stringify(form)})
            on conflict (key, version) do update set doc = excluded.doc`;
  await sql`insert into nf_workflow_definitions (key, version, doc) values (${workflow.key}, ${workflow.version}, ${JSON.stringify(workflow)})
            on conflict (key, version) do update set doc = excluded.doc`;
  console.log(`✓ Seeded form "${form.key}" + workflow "${workflow.key}".`);
} catch (err) {
  console.error('✗ Seed failed:', err.message);
  process.exit(1);
}
