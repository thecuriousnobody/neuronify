// M3 proof: one transcript → filled form + classification → a composed graph the
// engine actually accepts. Uses a scripted LLM (no network) so the deterministic
// guarantees — coercion, severity clamp, department allow-list, palette-only
// composition — are what's under test, not the model.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FormDefinition } from '../domain/types';
import { digestDrop, classify, extractFields, SEVERITIES } from './digest';
import { composeGraph } from './compose';
import { compileGraph } from '../workflow/graph';
import { ScriptedLLM } from '../testing/doubles';

const potholeForm: FormDefinition = {
  id: 'form-pothole',
  key: 'pothole_report',
  title: 'Pothole / road hazard',
  city: 'Peoria, IL',
  workflowKey: 'pothole_flow',
  version: 1,
  fields: [
    { key: 'location', label: 'Where is it?', type: 'location', required: true },
    { key: 'hazard', label: 'Is it a hazard?', type: 'boolean', required: true },
    { key: 'photos', label: 'Photo', type: 'attachment', required: true, requiresAttachment: true },
  ],
};

const DEPARTMENTS = ['public_works', 'water', 'parks', 'code_enforcement'];

const transcript =
  "There's a deep pothole at Main Street and 5th Avenue, it's taking up the whole right lane and cars are swerving. It's definitely a hazard.";

test('digestDrop: fills stated fields, leaves attachments, classifies within constraints', async () => {
  const llm = new ScriptedLLM([
    // extract stage
    JSON.stringify({ extracted: { location: 'Main St & 5th Ave', hazard: 'yes' } }),
    // classify stage
    JSON.stringify({ category: 'Roads & Infrastructure', severity: 'high', department: 'public_works', rationale: 'Travel-lane hazard causing swerving.' }),
  ]);

  const result = await digestDrop(llm, potholeForm, transcript, { departments: DEPARTMENTS });

  assert.equal(result.values.find((v) => v.fieldKey === 'location')?.value, 'Main St & 5th Ave');
  assert.equal(result.values.find((v) => v.fieldKey === 'hazard')?.value, true, 'coerced "yes" → boolean');
  assert.equal(result.values.find((v) => v.fieldKey === 'photos'), undefined, 'attachment not filled from transcript');
  assert.deepEqual(result.missing, ['photos'], 'the required photo is still missing');

  assert.ok(SEVERITIES.includes(result.classification.severity));
  assert.equal(result.classification.department, 'public_works');
  assert.equal(result.classification.severity, 'high');
});

test('classify clamps a bad severity and rejects an off-list department', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({ category: 'x', severity: 'catastrophic', department: 'ministry_of_magic', rationale: 'r' }),
  ]);
  const cls = await classify(llm, potholeForm, transcript, { departments: DEPARTMENTS });
  assert.equal(cls.severity, 'medium', 'unknown severity clamps to medium');
  assert.equal(cls.department, 'public_works', 'off-list department falls back to the first allowed');
});

test('compose → compile: the composed graph is one the engine accepts', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({ extracted: { location: 'Main St & 5th Ave', hazard: true } }),
    JSON.stringify({ category: 'Roads', severity: 'high', department: 'public_works', rationale: 'r' }),
  ]);
  const result = await digestDrop(llm, potholeForm, transcript, { departments: DEPARTMENTS });

  const graph = composeGraph(result.classification, {
    formKey: potholeForm.key,
    scope: result.values.map((v) => v.fieldKey),
  });

  // The whole point: the agent-composed graph compiles to an executable flow.
  const def = compileGraph(graph);
  assert.equal(def.steps.length, 1);
  assert.equal(def.steps[0].key, 'public_works_review');
  assert.equal(def.steps[0].approvals[0].approver, 'public_works');
  assert.deepEqual(def.steps[0].approvals[0].scope, ['location', 'hazard']);
});

test('extractFields never invents: an empty transcript yields no values', async () => {
  const llm = new ScriptedLLM([JSON.stringify({ extracted: {} })]);
  const values = await extractFields(llm, potholeForm, 'um, hello?');
  assert.equal(values.length, 0);
});
