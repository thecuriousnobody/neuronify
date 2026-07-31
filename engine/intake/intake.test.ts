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
