// One-shot schema setup. Usage: `npm run db:setup`
// Reads DATABASE_URL from the environment (.env.local is loaded by Next, but
// this standalone script reads process.env — export it or use `dotenv -e`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;

if (!url) {
  console.error('✗ DATABASE_URL is not set. Try:  DATABASE_URL="..." npm run db:setup');
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

try {
  // neon() can run a multi-statement string via the raw query path.
  await sql.query(schema);
  console.log('✓ Neuronify schema applied to Neon.');
} catch (err) {
  console.error('✗ Schema setup failed:', err.message);
  process.exit(1);
}
