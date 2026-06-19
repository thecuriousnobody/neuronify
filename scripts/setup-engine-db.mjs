// One-shot v2 engine schema setup. Usage: `npm run engine:db:setup`
// Mirrors scripts/setup-db.mjs but applies db/engine-schema.sql. Additive and
// idempotent (create table if not exists) — safe to re-run; does not touch v1.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

loadEnv(join(root, '.env.local'));

const raw = process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING;
if (!raw) {
  console.error('✗ DATABASE_URL / POSTGRES_CONNECTION_STRING is not set (.env.local).');
  process.exit(1);
}

const urlMatch = raw.match(/postgres(?:ql)?:\/\/[^\s'"]+/);
const url = urlMatch ? urlMatch[0] : raw.trim();
const sql = neon(url);
const schema = readFileSync(join(root, 'db', 'engine-schema.sql'), 'utf8');

const run = (text) => {
  const ts = [text];
  ts.raw = [text];
  return sql(ts);
};

const statements = schema
  .replace(/--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

try {
  await run('select 1');
  for (const stmt of statements) await run(stmt);
  console.log(`✓ Neuronify v2 engine schema applied to Neon (${statements.length} statements).`);
} catch (err) {
  console.error('✗ Engine schema setup failed:', err.message);
  process.exit(1);
}
