// Every route that emits communications must also deliver them.
//
// The engine's `commit()` writes CommunicationIntents to nf_communications and
// stops there — emission is deliberately decoupled from delivery so the audit
// row survives a failed send. The cost of that design is that delivery is
// opt-in at every call site, and a call site that forgets doesn't break: the
// report files, the resident gets a reference number, and the department's
// "a report just came in" nudge sits undelivered until someone opens that case
// for an unrelated reason. The alert fires only once it's useless.
//
// /api/v2/submit-anon forgot for the entire life of the route-direct flow —
// the one path with no staff confirm step, i.e. the one that needed the nudge
// most. This test is here so the next new filing path can't repeat it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVICE = join(ROOT, 'engine/workflow/service.ts');

/**
 * Engine entry points that can queue an outbox row. The `record*` / `submit*`
 * ones call `commit()` directly; `deskDecide` / `deskReassign` are the console
 * wrappers around `recordDecision` / `recordReassignment`, so a route can reach
 * the outbox by naming either.
 */
const WRAPPERS = ['deskDecide', 'deskReassign'];

/** Exported service functions whose own body calls `commit()`. */
function directEmitters(): string[] {
  const src = readFileSync(SERVICE, 'utf8');
  const chunks = src.split(/^export async function /m).slice(1);
  return chunks
    .filter((chunk) => /\bcommit\(env/.test(chunk))
    .map((chunk) => chunk.slice(0, chunk.indexOf('(')).trim());
}

function routeFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, found);
    else if (entry.name === 'route.ts') found.push(full);
  }
  return found;
}

test('the emitter list still matches the engine', () => {
  // Guards the guard: if someone adds a new committing service function, this
  // fails and makes them decide whether routes calling it must drain too.
  assert.deepEqual(directEmitters().sort(), [
    'recordDecision',
    'recordReassignment',
    'recordResubmit',
    'recordRevisionAndResubmit',
    'submitForm',
    'submitGraph',
  ]);
});

test('every route that emits communications drains the outbox', () => {
  const emitters = [...directEmitters(), ...WRAPPERS];
  const offenders: string[] = [];

  for (const file of routeFiles(join(ROOT, 'app/api'))) {
    const src = readFileSync(file, 'utf8');
    // `name(` rather than bare `name` so an import list doesn't count as a call.
    const emits = emitters.filter((fn) => src.includes(`${fn}(`));
    if (emits.length && !src.includes('drainOutbox(')) {
      offenders.push(`${file.slice(ROOT.length)} calls ${emits.join(', ')}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These routes queue communications but never deliver them — add ` +
      `\`await drainOutbox(submissionId).catch(() => {})\` after the engine call:\n  ` +
      offenders.join('\n  '),
  );
});
