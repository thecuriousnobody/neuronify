// The intake system prompt carries rules that are load-bearing for behaviour we
// have already been burned by: the assistant promising a photo upload the city
// cannot honour, and re-asking for facts the resident stated in their opening
// message (both Blake, 2026-08-07). Prompts are advisory to the model, so these
// tests do not prove the model obeys — they prove the instruction is still THERE.
// Deleting a rule during a refactor should break a test, not a resident's report.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FormDefinition } from '../domain/types';
import { intakeSystemPrompt, MAX_QUESTIONS_PER_TURN } from './prompt';

const form: FormDefinition = {
  id: 'form-pothole',
  key: 'intake_pothole',
  title: 'Pothole report',
  city: 'Peoria, IL',
  version: 1,
  workflowKey: 'public_works_flow',
  fields: [
    { key: 'location', label: 'Where is it?', type: 'text', required: true },
    { key: 'hazard', label: 'Is it dangerous?', type: 'boolean', required: true },
    { key: 'severity', label: 'How bad?', type: 'choice', required: false, choices: ['minor', 'major'] },
    { key: 'photos', label: 'A photo', type: 'attachment', required: true, requiresAttachment: true },
  ],
};

test('every field, its type, and its choices reach the model', () => {
  const p = intakeSystemPrompt(form);
  for (const f of form.fields) {
    assert.ok(p.includes(`"${f.key}"`), `${f.key} is described to the model`);
    assert.ok(p.includes(f.label), `${f.key}'s label is included`);
  }
  assert.ok(p.includes('minor | major'), 'choice lists are enumerated');
  assert.ok(p.includes('required'), 'requiredness is stated');
});

test('the assistant is told to mine the whole message, not just the last answer', () => {
  const p = intakeSystemPrompt(form);
  assert.match(p, /WHOLE message/i, 'multi-fact openers must be extracted in full');
  assert.match(p, /Never ask again for something they have already told you/i);
});

test('the assistant is told the newest, most specific answer wins', () => {
  assert.match(intakeSystemPrompt(form), /most specific answer wins/i);
});

test('the assistant is forbidden from promising a photo can be added after filing', () => {
  // Blake 1.2: it promised, the promise reached nothing, and the record lost the
  // context entirely. There is no post-filing upload path — so it must not offer one.
  const p = intakeSystemPrompt(form);
  assert.match(p, /NEVER tell the resident they can add a photo after filing/i);
  assert.match(p, /no way to add one after they file/i);
  assert.match(p, /extract their answer as the value of the attachment field/i);
});

test('the question budget rule tracks MAX_QUESTIONS_PER_TURN', () => {
  const p = intakeSystemPrompt(form);
  if (MAX_QUESTIONS_PER_TURN <= 1) {
    assert.match(p, /ONE question at a time\./);
  } else {
    assert.ok(
      p.includes(`up to ${MAX_QUESTIONS_PER_TURN} details in a single reply`),
      'the batching allowance names the configured budget',
    );
    assert.match(p, /never ask for more than/i, 'the ceiling is stated');
    assert.match(p, /closely related/i, 'batching is scoped to related fields');
  }
});

test('the anti-wrap-up rules survive', () => {
  // The engine's false-wrap-up guard is the backstop; this is the front line.
  const p = intakeSystemPrompt(form);
  assert.match(p, /NEVER say you are sending, filing, or submitting/i);
  assert.match(p, /your reply MUST end with a question/i);
});

test('output is constrained to bare JSON', () => {
  const p = intakeSystemPrompt(form);
  assert.match(p, /Output ONLY raw JSON/i);
  assert.match(p, /no code fences/i);
});
