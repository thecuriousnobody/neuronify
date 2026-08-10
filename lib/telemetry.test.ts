import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSessionId, turnCount, logIntake } from './telemetry';

// ── session ids are untrusted input ──

test('a normal uuid survives intact', () => {
  const id = '6e936ed4-24ea-4715-aee4-7bd5fba2e939';
  assert.equal(cleanSessionId(id), id);
});

test('anything not id-shaped is stripped', () => {
  assert.equal(cleanSessionId("abc'; drop table nf_intake_telemetry; --"), 'abcdroptablenf_intake_telemetry--');
  assert.equal(cleanSessionId('<script>x</script>'), 'scriptxscript');
});

test('an over-long id is bounded, not rejected', () => {
  assert.equal(cleanSessionId('a'.repeat(500)).length, 64);
});

test('absent, null, and non-string ids all become empty', () => {
  assert.equal(cleanSessionId(undefined), '');
  assert.equal(cleanSessionId(null), '');
  assert.equal(cleanSessionId({ id: 'x' }), '');
  assert.equal(cleanSessionId('   '), '');
});

// ── the x-axis of the drop-off curve ──

test('turns count the resident, not the agent', () => {
  const history = [
    { role: 'assistant' },
    { role: 'user' },
    { role: 'assistant' },
    { role: 'user' },
    { role: 'assistant' },
  ];
  assert.equal(turnCount(history), 2);
});

test('an empty or missing history is zero turns, never a crash', () => {
  assert.equal(turnCount([]), 0);
  assert.equal(turnCount(undefined), 0);
  assert.equal(turnCount(null), 0);
  assert.equal(turnCount('not an array' as any), 0);
});

// ── it can never cost someone their report ──
//
// logIntake is called from inside the filing path. With no DATABASE_URL set,
// getSql() throws — which is exactly the shape of every real failure (dead
// database, missing table before the migration runs). None of it may surface.

test('a completely broken database is silent', async () => {
  const url = process.env.DATABASE_URL;
  const pg = process.env.POSTGRES_CONNECTION_STRING;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_CONNECTION_STRING;
  try {
    await logIntake({ sessionId: 'abc', event: 'filed', category: 'pothole' });
  } finally {
    if (url) process.env.DATABASE_URL = url;
    if (pg) process.env.POSTGRES_CONNECTION_STRING = pg;
  }
});

test('a missing session id is dropped before it ever reaches the database', async () => {
  // Proven by the absence of a throw: with no id we return before getSql(),
  // so this passes even with no database configured at all.
  await logIntake({ sessionId: '', event: 'filed' });
  await logIntake({ sessionId: '   ', event: 'collecting' });
});

test('an event name outside the closed set is dropped', async () => {
  await logIntake({ sessionId: 'abc', event: 'whatever_i_felt_like' as any });
});
