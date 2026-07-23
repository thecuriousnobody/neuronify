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
let ok = 0;
try {
  for (const form of forms) {
    await sql`insert into nf_form_definitions (key, version, doc) values (${form.key}, ${form.version}, ${JSON.stringify(form)})
              on conflict (key, version) do update set doc = excluded.doc`;
    ok++;
  }
  console.log(`✓ Seeded ${ok} category forms into nf_form_definitions.`);
} catch (err) {
  console.error(`✗ Seed failed after ${ok}/${forms.length}:`, (err as Error).message);
  process.exit(1);
}
