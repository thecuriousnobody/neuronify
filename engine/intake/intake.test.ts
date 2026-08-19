// Phase 3 proof: the intake conversation merges extracted values deterministically
// and decides completeness in code (not via the model). The LLM is scripted, so
// these assertions are about the engine's own logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FormDefinition } from '../domain/types';
import { runIntakeTurn, type ChatMessage } from './conversation';
import { ScriptedLLM } from '../testing/memory';

const form: FormDefinition = {
  id: 'form-pothole',
  key: 'pothole_report',
  title: 'Pothole report',
  city: 'Peoria, IL',
  version: 1,
  workflowKey: 'pothole_flow',
  fields: [
    { key: 'location', label: 'Where is it?', type: 'text', required: true },
    { key: 'hazard', label: 'Is it dangerous?', type: 'boolean', required: true },
    { key: 'severity', label: 'How bad?', type: 'choice', required: false, choices: ['minor', 'major'] },
    { key: 'photos', label: 'A photo', type: 'attachment', required: true, requiresAttachment: true },
  ],
};

test('extracts a value, reports what is still missing, not ready yet', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: 'Got it. Is it dangerous to drive over?', extracted: { location: 'Knoxville & Sheridan' } }),
  ]);
  const turn = await runIntakeTurn(llm, form, [], [], 'big pothole on Knoxville at Sheridan');

  assert.equal(turn.draft.find((v) => v.fieldKey === 'location')?.value, 'Knoxville & Sheridan');
  assert.deepEqual(turn.missing.sort(), ['hazard', 'photos'], 'hazard + attachment still needed');
  assert.equal(turn.readyForReview, false);
  assert.match(turn.reply, /dangerous/i);
});

test('coerces booleans; attachment does not block readiness', async () => {
  const history: ChatMessage[] = [
    { role: 'user', text: 'big pothole on Knoxville at Sheridan' },
    { role: 'assistant', text: 'Is it dangerous?' },
  ];
  const prior = [{ fieldKey: 'location', value: 'Knoxville & Sheridan' }];
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: "Thanks — you can review and submit, then add a photo.", extracted: { hazard: 'yes' } }),
  ]);
  const turn = await runIntakeTurn(llm, form, history, prior, 'yeah it already bent my rim');

  assert.equal(turn.draft.find((v) => v.fieldKey === 'hazard')?.value, true, 'yes -> true');
  assert.deepEqual(turn.missing, ['photos'], 'only the attachment remains');
  assert.equal(turn.readyForReview, true, 'attachment is collected at review, not in chat');
});

test('ignores hallucinated / uncoercible extractions', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: 'ok', extracted: { severity: 'catastrophic', nonexistent: 'x', location: 'Main St' } }),
  ]);
  const turn = await runIntakeTurn(llm, form, [], [], 'on Main Street');

  assert.equal(turn.draft.find((v) => v.fieldKey === 'location')?.value, 'Main St');
  assert.equal(turn.draft.find((v) => v.fieldKey === 'severity'), undefined, 'value not in choices is dropped');
  assert.equal(turn.draft.find((v) => v.fieldKey === 'nonexistent'), undefined, 'unknown field is dropped');
});

test('suggestions pass through sanitized; junk is dropped', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({
      reply: 'Middle of the intersection, or on a corner?',
      extracted: {},
      suggestions: [
        'Middle of the intersection',
        'On a corner',
        '  On a corner ', // dupe after trim (case-insensitive)
        42, // not a string
        '', // empty
        'x'.repeat(60), // too long for a button
        'a', 'b', 'c', 'd', // overflow past 5
      ],
    }),
  ]);
  const turn = await runIntakeTurn(llm, form, [], [], 'at Adams and Main');
  assert.deepEqual(turn.suggestions, ['Middle of the intersection', 'On a corner', 'a', 'b', 'c']);
});

test('no suggestions field → empty array, never undefined', async () => {
  const llm = new ScriptedLLM([JSON.stringify({ reply: 'Where is it?', extracted: {} })]);
  const turn = await runIntakeTurn(llm, form, [], [], 'pothole');
  assert.deepEqual(turn.suggestions, []);
});

test('a question-free reply mid-collection gets the next missing field appended (the "sending it now" bug)', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({
      reply: "Thanks — I'm sending this to our street repair team right now.",
      extracted: { location: 'Pioneer Parkway near University Junction' },
    }),
  ]);
  const turn = await runIntakeTurn(llm, form, [], [], 'the median is broken, a section is missing');
  assert.equal(turn.readyForReview, false, 'hazard still missing — not ready');
  assert.match(turn.reply, /\?$/, 'reply must end with a question while fields are missing');
  assert.match(turn.reply, /Is it dangerous/i, 'asks the next missing required field');
});

// ── Blake's 2026-08-07 findings ──────────────────────────────────────────────

test('a multi-fact opening message fills every slot it mentions in ONE turn (Blake 1.1)', async () => {
  // Residents lead with everything they know. The engine must bank all of it on
  // the spot; re-asking for what they already said was the worst thing Blake hit.
  const llm = new ScriptedLLM([
    JSON.stringify({
      reply: 'Thanks — how bad would you say it is?',
      extracted: { location: '4th and Main', hazard: 'yes', severity: 'major' },
    }),
  ]);
  const turn = await runIntakeTurn(
    llm,
    form,
    [],
    [],
    'huge pothole at 4th and Main, right in the traffic lane, people are swerving around it',
  );

  assert.equal(turn.draft.find((v) => v.fieldKey === 'location')?.value, '4th and Main');
  assert.equal(turn.draft.find((v) => v.fieldKey === 'hazard')?.value, true);
  assert.equal(turn.draft.find((v) => v.fieldKey === 'severity')?.value, 'major');
  assert.deepEqual(turn.missing, ['photos'], 'nothing but the photo is left to ask for');
  assert.equal(turn.readyForReview, true, 'a complete opener goes straight to review');
});

test('answering only one of two batched questions leaves the other slot missing (Blake §2)', async () => {
  // Why batching is safe here: the draft is a slot set, not a script. A partial
  // answer is not a lost answer — the empty slot is simply still empty.
  const llm = new ScriptedLLM([
    // The assistant asked for hazard AND severity; the resident answered hazard.
    JSON.stringify({ reply: 'Got it. And how big is it?', extracted: { hazard: 'yes' } }),
    JSON.stringify({ reply: 'Thanks.', extracted: { severity: 'minor' } }),
  ]);
  const first = await runIntakeTurn(llm, form, [], [{ fieldKey: 'location', value: '4th and Main' }], 'yes, dangerous');
  assert.equal(first.draft.find((v) => v.fieldKey === 'hazard')?.value, true);
  assert.equal(first.draft.find((v) => v.fieldKey === 'severity'), undefined, 'unanswered half stays empty');

  const second = await runIntakeTurn(llm, form, [], first.draft, 'small one');
  assert.equal(second.draft.find((v) => v.fieldKey === 'severity')?.value, 'minor', 're-asking recovers it');
  assert.equal(second.draft.find((v) => v.fieldKey === 'hazard')?.value, true, 'the answered half survived');
});

test('a later, more specific answer overwrites the earlier one (Blake 4.5)', async () => {
  const prior = [{ fieldKey: 'location', value: 'near the Riverfront Museum' }];
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: 'Thanks, that helps. Is it dangerous?', extracted: { location: '222 SW Washington St' } }),
  ]);
  const turn = await runIntakeTurn(llm, form, [], prior, "actually it's right outside 222 SW Washington St");
  assert.equal(
    turn.draft.find((v) => v.fieldKey === 'location')?.value,
    '222 SW Washington St',
    'newest, most specific answer wins',
  );
  assert.equal(turn.draft.filter((v) => v.fieldKey === 'location').length, 1, 'one slot, not two');
});

test('re-extracting a value keeps the photo and geocode already attached to that slot', async () => {
  // The model can restate a location string but cannot restate a resolved pin or
  // an uploaded blob — clobbering the whole entry would silently drop both.
  const prior = [
    {
      fieldKey: 'location',
      value: 'Knoxville & Sheridan',
      geo: { lat: 40.7, lon: -89.6, matched: 'N Knoxville Ave & W Sheridan Rd' },
    },
    { fieldKey: 'photos', value: null, attachmentIds: ['https://store.private.blob.vercel-storage.com/a.jpg'] },
  ];
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: 'Is it dangerous?', extracted: { location: 'Knoxville and Sheridan' } }),
  ]);
  const turn = await runIntakeTurn(llm, form, [], prior, 'Knoxville and Sheridan');

  const loc = turn.draft.find((v) => v.fieldKey === 'location');
  assert.equal(loc?.value, 'Knoxville and Sheridan', 'value updated');
  assert.deepEqual(loc?.geo, { lat: 40.7, lon: -89.6, matched: 'N Knoxville Ave & W Sheridan Rd' }, 'geo survived');
  assert.deepEqual(
    turn.draft.find((v) => v.fieldKey === 'photos')?.attachmentIds,
    ['https://store.private.blob.vercel-storage.com/a.jpg'],
    'untouched slot keeps its attachment',
  );
});

test('a "why no photo" reason given in chat fills the attachment slot (Blake 1.2)', async () => {
  // The bot used to say "you can add it later" and nothing carried that anywhere.
  // Now the reason itself is the slot value, so the crew sees why.
  const prior = [
    { fieldKey: 'location', value: '4th and Main' },
    { fieldKey: 'hazard', value: true },
  ];
  const llm = new ScriptedLLM([
    JSON.stringify({
      reply: 'No problem at all — thanks for telling me.',
      extracted: { photos: 'my phone camera is broken' },
    }),
  ]);
  const turn = await runIntakeTurn(llm, form, [], prior, "I can't take a photo, my phone camera is broken");

  assert.equal(turn.draft.find((v) => v.fieldKey === 'photos')?.value, 'my phone camera is broken');
  assert.deepEqual(turn.missing, [], 'a recorded reason satisfies the photo requirement');
});

// ── Rajeev's 2026-08-18 findings (docs/intake-capture-and-location-plan.md) ──

// A form with the production shape: a required prose description alongside the
// specific fields. The shared `form` above predates the taxonomy build and has
// no longtext field, which is exactly the field these regressions are about.
const proseForm: FormDefinition = {
  id: 'form-pothole-v2',
  key: 'intake_pothole',
  title: 'Pothole',
  city: 'Peoria, IL',
  version: 1,
  workflowKey: 'public_works_flow',
  fields: [
    { key: 'location', label: 'Where is it?', type: 'location', required: true },
    { key: 'description', label: 'What’s going on?', type: 'longtext', required: true },
    { key: 'hazard', label: 'Is it a safety hazard?', type: 'boolean', required: true },
    { key: 'photo', label: 'A photo', type: 'attachment', required: true, requiresAttachment: true },
  ],
};

const RAJEEV_OPENER =
  "Yeah hi, I want to report a large pothole at Knoxville and Fry. It's right in the traffic lane and it's a safety hazard.";

test('a prose opener the model mined for specifics but not description backstops description with the opener verbatim (Finding 6)', async () => {
  // Reproduced live 6/6: the model extracts location + hazard and reads the
  // problem back, but never writes `description` — then asks for it.
  const llm = new ScriptedLLM([
    JSON.stringify({
      reply: 'Thanks — got the location and that it’s a hazard.',
      extracted: { location: 'Knoxville and Fry', hazard: 'yes' },
    }),
  ]);
  const turn = await runIntakeTurn(llm, proseForm, [], [], RAJEEV_OPENER);

  assert.equal(
    turn.draft.find((v) => v.fieldKey === 'description')?.value,
    RAJEEV_OPENER,
    'the opener itself — verbatim — is the description',
  );
  assert.deepEqual(turn.missing, ['photo'], 'description no longer missing');
  assert.equal(turn.readyForReview, true);
});

test('an opener that carried no extractable facts does NOT backstop description', async () => {
  // "pothole" alone describes nothing — asking what's going on is correct here.
  const llm = new ScriptedLLM([JSON.stringify({ reply: 'Where is it?', extracted: {} })]);
  const turn = await runIntakeTurn(llm, proseForm, [], [], 'pothole');
  assert.equal(turn.draft.find((v) => v.fieldKey === 'description'), undefined);
  assert.ok(turn.missing.includes('description'));
});

test('mid-conversation answers are never mistaken for a description (backstop is opener-only)', async () => {
  // "It's at Knoxville and Fry" answers WHERE, and must not become WHAT.
  const prior = [{ fieldKey: 'hazard', value: true }];
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: 'Got it.', extracted: { location: 'Knoxville and Fry' } }),
  ]);
  const turn = await runIntakeTurn(llm, proseForm, [], prior, "It's at Knoxville and Fry");
  assert.equal(turn.draft.find((v) => v.fieldKey === 'description'), undefined);
  assert.ok(turn.missing.includes('description'));
});

test('when the model DOES extract a description, the backstop leaves it alone', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({
      reply: 'Thanks!',
      extracted: { location: 'Knoxville and Fry', description: 'large pothole in the traffic lane' },
    }),
  ]);
  const turn = await runIntakeTurn(llm, proseForm, [], [], RAJEEV_OPENER);
  assert.equal(
    turn.draft.find((v) => v.fieldKey === 'description')?.value,
    'large pothole in the traffic lane',
  );
});

test('a false wrap-up is SUPPRESSED, not decorated — the turn no longer contradicts itself (Finding 6)', async () => {
  // The observed turn: "You're all set to review and submit your report. One
  // more thing — What's going on?" — a wrap-up claim followed by a question.
  const prior = [
    { fieldKey: 'location', value: 'Knoxville and Fry' },
    { fieldKey: 'hazard', value: true },
  ];
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: "You're all set to review and submit your report.", extracted: {} }),
  ]);
  const turn = await runIntakeTurn(llm, proseForm, [], prior, 'nope');
  assert.equal(turn.readyForReview, false, 'description still missing — guard must fire');
  assert.doesNotMatch(turn.reply, /all set|review and submit/i, 'the false claim is gone');
  assert.equal(turn.reply, 'What’s going on?', 'just the question, no "One more thing —" pasting');
});

test('a rhetorical question inside a false wrap-up no longer defeats the guard', async () => {
  // The old probe was reply.includes('?') — "sound good?" satisfied it and the
  // dead-end wrap-up survived untouched.
  const prior = [
    { fieldKey: 'location', value: 'Knoxville and Fry' },
    { fieldKey: 'hazard', value: true },
  ];
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: "You're all set to review and submit — sound good?", extracted: {} }),
  ]);
  const turn = await runIntakeTurn(llm, proseForm, [], prior, 'nope');
  assert.doesNotMatch(turn.reply, /all set/i);
  assert.match(turn.reply, /going on\?$/, 'asks for the actually-missing field');
});

test('stripping a wrap-up claim keeps the acknowledgment around it', async () => {
  const prior = [{ fieldKey: 'location', value: 'Knoxville and Fry' }];
  const llm = new ScriptedLLM([
    JSON.stringify({
      reply: 'Thanks, that helps. You’re all set to submit.',
      extracted: {},
    }),
  ]);
  const turn = await runIntakeTurn(llm, proseForm, [], prior, 'ok');
  assert.match(turn.reply, /^Thanks, that helps\./, 'the honest sentence survives');
  assert.doesNotMatch(turn.reply, /all set/i);
  assert.match(turn.reply, /\?$/, 'and the next question follows');
});

test('a genuine wrap-up when everything is gathered is left alone', async () => {
  const prior = [
    { fieldKey: 'location', value: 'Knoxville & Sheridan' },
    { fieldKey: 'hazard', value: true },
  ];
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: 'That’s everything — review and submit when ready.', extracted: {} }),
  ]);
  const turn = await runIntakeTurn(llm, form, [], prior, 'nope, that’s all');
  assert.equal(turn.readyForReview, true);
  assert.equal(turn.reply, 'That’s everything — review and submit when ready.', 'no question appended');
});
