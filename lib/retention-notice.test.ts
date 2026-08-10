// If we keep what a resident says, we tell them before they say it.
//
// The intake conversation is retained as part of the case record — deliberately,
// as evidence (docs/transcript-retention.md). That decision is defensible. Not
// mentioning it to the person doing the talking is not, and it was the state of
// this app through every build up to now: two front doors, one of them
// voice-only, neither saying a word about where the words went.
//
// Voice is why this matters more here than on an ordinary form. People say
// names, house numbers and phone numbers out loud that they would never type
// into a field, because talking to an assistant feels like talking, not filing.
//
// This guards the CLASS. `/report/chat` replaced `/report` without carrying the
// notice forward because there was no notice to carry; the next door added will
// fail this test instead of shipping silent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Endpoints that receive the resident's own words and retain them. */
const INTAKE_APIS = ['api/v2/converse', 'api/v2/submit-anon', 'api/v2/report'];

function pageFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pageFiles(full, found);
    else if (entry.name.endsWith('.tsx')) found.push(full);
  }
  return found;
}

test('every surface that captures a resident’s words carries the retention notice', () => {
  const offenders: string[] = [];

  for (const file of pageFiles(join(ROOT, 'app'))) {
    const src = readFileSync(file, 'utf8');
    if (!INTAKE_APIS.some((api) => src.includes(api))) continue;
    // The notice is rendered through a `retention` style hook on both doors —
    // checking the hook rather than the prose lets the wording be improved
    // without breaking the test, while still failing if it disappears.
    if (!/styles\.retention/.test(src)) {
      offenders.push(file.slice(ROOT.length));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These pages send the resident's words to an intake API that retains them, ` +
      `but never tell the resident that:\n  ${offenders.join('\n  ')}`,
  );
});

test('the notice says the two things that are actually true', () => {
  // Retention alone is not the disclosure. "It is kept" and "staff can read it"
  // are different facts, and someone deciding what to say out loud needs both.
  for (const page of ['app/report/page.tsx', 'app/report/chat/page.tsx']) {
    const src = readFileSync(join(ROOT, page), 'utf8');
    const notice = src.slice(src.indexOf('styles.retention'));
    assert.match(notice, /saved with your report/i, `${page}: doesn't say it is kept`);
    assert.match(notice, /city staff/i, `${page}: doesn't say who can read it`);
  }
});
