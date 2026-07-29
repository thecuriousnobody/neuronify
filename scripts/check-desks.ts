// Preflight: does every department the taxonomy routes to actually have a desk?
//
// Usage: npm run desks:check
//
// A report routed to a department with no DESK_PASSCODES entry opens a workflow
// nobody can sign in to — it persists, notifies, and is then invisible. That is
// exactly what happened on 2026-07-28: DESK_PASSCODES still carried the v1
// department names (community_development, water, parks) while the taxonomy
// routes to canonical keys (police, parks_rec), so 5 of 22 categories pointed
// into a black hole. The submit path now reroutes to a staffed desk rather than
// vanishing, but a reroute is a degraded outcome — this script is how you find
// out BEFORE residents do.
//
// Exits 1 if any canonical owner is unstaffed, so it can gate a deploy.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CATEGORIES, departmentFor } from '../engine/intake/taxonomy';
import { TEMPLATE_FORM_CITY } from '../engine/intake/forms';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Owners that are deliberately NOT a city desk. Peoria's drinking water is
 * Illinois American Water, a private utility — those reports are referred out,
 * not routed to a queue. Missing a passcode here is correct, not a misconfig.
 */
const NOT_A_CITY_DESK = new Set(['water_external']);

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

// Read only the department NAMES — never print a passcode.
const staffed = new Set(
  (process.env.DESK_PASSCODES || '')
    .split(',')
    .map((p) => p.slice(0, p.indexOf(':')).trim())
    .filter(Boolean),
);

function main(): void {
  if (staffed.size === 0) {
    console.error('✗ DESK_PASSCODES is unset or empty — no desk can be signed into at all.');
    process.exit(1);
  }

  console.log(`Desks configured (${staffed.size}): ${[...staffed].sort().join(', ')}\n`);

  const byDept = new Map<string, string[]>();
  for (const c of CATEGORIES) {
    const d = departmentFor(TEMPLATE_FORM_CITY, c.key);
    byDept.set(d, [...(byDept.get(d) ?? []), c.key]);
  }

  const unstaffed: string[] = [];
  for (const [dept, cats] of [...byDept].sort()) {
    const ok = staffed.has(dept);
    // Not every owner is a city desk. Peoria's drinking water is Illinois
    // American Water — a private utility the report is referred OUT to, so it
    // has no passcode by design. Flag it, don't fail on it.
    const byDesign = NOT_A_CITY_DESK.has(dept);
    if (!ok && !byDesign) unstaffed.push(dept);
    const mark = ok ? '✓' : byDesign ? '·' : '✗';
    const note = ok
      ? ''
      : byDesign
        ? '  ← not a city desk (refer-out, by design)'
        : `  ← NO DESK: ${cats.join(', ')}`;
    console.log(
      `  ${mark} ${dept.padEnd(20)} ${String(cats.length).padStart(2)} categor${cats.length === 1 ? 'y ' : 'ies'}${note}`,
    );
  }

  // Desks configured but never routed to — usually leftovers from an older
  // department naming scheme. Harmless, but they mean someone can sign in to a
  // queue that will never receive anything.
  const routed = new Set(byDept.keys());
  const unused = [...staffed].filter((d) => !routed.has(d)).sort();
  if (unused.length) {
    console.log(`\n  ℹ ${unused.length} desk(s) configured but never routed to: ${unused.join(', ')}`);
  }

  if (unstaffed.length) {
    console.error(
      `\n✗ ${unstaffed.length} department(s) have no desk: ${unstaffed.join(', ')}.\n` +
        `  Reports for their categories will be rerouted to a staffed desk for manual\n` +
        `  reassignment instead of going straight through. Add to DESK_PASSCODES:\n` +
        unstaffed.map((d) => `    ${d}:<passcode>`).join('\n'),
    );
    process.exit(1);
  }

  console.log('\n✓ Every department the taxonomy routes to has a desk.');
}

main();
