import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// Lazy singleton so importing this module never crashes a build when
// DATABASE_URL is absent (e.g. landing page render). Routes that touch
// the DB call getSql() at request time.
let _sql: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    // Accept either name — POSTGRES_CONNECTION_STRING matches the convention
    // used across the other Neon projects.
    const raw = process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING;
    if (!raw) throw new Error('DATABASE_URL / POSTGRES_CONNECTION_STRING is not set');
    // Tolerate values pasted as `psql '...'` or wrapped in quotes.
    const match = raw.match(/postgres(?:ql)?:\/\/[^\s'"]+/);
    const url = match ? match[0] : raw.trim();
    // Next.js patches global fetch with caching; the Neon HTTP driver runs on
    // fetch, so without no-store reads return stale rows. Disable it.
    _sql = neon(url, { fetchOptions: { cache: 'no-store' } });
  }
  return _sql;
}
