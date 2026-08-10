// Where is the intake losing people?
//
// Usage: npm run intake:funnel  [days]
//
// Reads nf_intake_telemetry and answers the question the product could not
// answer at all before 2026-08-10: of everyone who started a report, who
// finished, and where did the rest give up?
//
// Abandonment is DERIVED here, not recorded. A conversation is one session_id;
// if its last row is not 'filed', the resident walked away, and that row names
// the category they were reporting, how many messages in they were, and which
// questions were still unanswered. That last part is the actionable bit — a
// field key that keeps showing up in `missing` on abandoned conversations is a
// question people won't answer.
//
// Reads only. Touches nothing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Same .env.local loader the other scripts carry — the repo has no dotenv
// dependency and this is not the place to add one.
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
loadEnvLocal();

import { getSql } from '../lib/db';

type Row = Record<string, any>;

const days = Number(process.argv[2] ?? 30);
if (!Number.isFinite(days) || days <= 0) {
  console.error('Usage: npm run intake:funnel [days]');
  process.exit(1);
}

function pct(n: number, of: number): string {
  if (!of) return '—';
  return `${((n / of) * 100).toFixed(1)}%`;
}

async function main() {
  const sql = getSql();

  // One row per conversation: where it got to, and what it was about.
  const sessions = (await sql`
    with last_row as (
      select distinct on (session_id)
        session_id, event, category, department, turn, ready, missing, created_at
      from nf_intake_telemetry
      where created_at > now() - (${days} || ' days')::interval
      order by session_id, id desc
    )
    select * from last_row
  `) as Row[];

  if (sessions.length === 0) {
    console.log(`No intake telemetry in the last ${days} days.`);
    console.log('If this is unexpected: has `npm run engine:db:setup` been run since 2026-08-10?');
    return;
  }

  const filed = sessions.filter((s) => s.event === 'filed');
  const abandoned = sessions.filter((s) => s.event !== 'filed');
  // Never got past triage — the agent could not work out what they were
  // reporting. A different failure from losing them mid-form, and a much worse
  // one: these people never even saw a question.
  const stuckInTriage = abandoned.filter((s) => s.event === 'triage');

  console.log(`\n  INTAKE FUNNEL — last ${days} days\n`);
  console.log(`  Conversations started   ${sessions.length}`);
  console.log(`  Filed                   ${filed.length}  (${pct(filed.length, sessions.length)})`);
  console.log(
    `  Abandoned               ${abandoned.length}  (${pct(abandoned.length, sessions.length)})`,
  );
  console.log(
    `    ...never categorised  ${stuckInTriage.length}  (${pct(stuckInTriage.length, sessions.length)} of all starts)`,
  );

  // ── by category ──
  const byCat = new Map<string, { started: number; filed: number }>();
  for (const s of sessions) {
    const key = s.category ?? '(never categorised)';
    const e = byCat.get(key) ?? { started: 0, filed: 0 };
    e.started++;
    if (s.event === 'filed') e.filed++;
    byCat.set(key, e);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1].started - a[1].started);
  console.log(`\n  BY CATEGORY\n`);
  console.log(`  ${'category'.padEnd(26)} ${'start'.padStart(6)} ${'filed'.padStart(6)}  completion`);
  for (const [cat, e] of cats) {
    const rate = pct(e.filed, e.started);
    // A category people start and don't finish is a form problem, not a
    // demand signal. Flag the ones worth looking at.
    const flag = e.started >= 5 && e.filed / e.started < 0.5 ? '  ← losing people' : '';
    console.log(
      `  ${cat.padEnd(26)} ${String(e.started).padStart(6)} ${String(e.filed).padStart(6)}  ${rate.padStart(10)}${flag}`,
    );
  }

  // ── how far they got before giving up ──
  const turns = abandoned.map((s) => Number(s.turn ?? 0)).filter((n) => n > 0).sort((a, b) => a - b);
  if (turns.length) {
    const median = turns[Math.floor(turns.length / 2)];
    const oneAndDone = turns.filter((t) => t === 1).length;
    console.log(`\n  WHERE THEY GAVE UP\n`);
    console.log(`  Median messages before abandoning   ${median}`);
    console.log(
      `  Left after a single message         ${oneAndDone}  (${pct(oneAndDone, abandoned.length)} of abandons)`,
    );
  }

  // ── the questions people won't answer ──
  const missCount = new Map<string, number>();
  for (const s of abandoned) {
    for (const key of (s.missing ?? []) as string[]) {
      missCount.set(key, (missCount.get(key) ?? 0) + 1);
    }
  }
  const worst = [...missCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (worst.length) {
    console.log(`\n  QUESTIONS OUTSTANDING WHEN THEY LEFT\n`);
    for (const [key, n] of worst) {
      console.log(`  ${String(n).padStart(5)}  ${key}`);
    }
    console.log(
      `\n  (A field high on this list is one people won't answer — consider making it\n   optional, asking it later, or asking it differently.)`,
    );
  }

  console.log('');
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (/nf_intake_telemetry.*does not exist/.test(msg)) {
    console.error(
      '\n  The telemetry table has not been created yet.\n' +
        '  Run:  npm run engine:db:setup   (additive and idempotent)\n',
    );
    process.exit(1);
  }
  console.error(msg);
  process.exit(1);
});
