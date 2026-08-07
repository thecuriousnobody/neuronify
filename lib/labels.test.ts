// The `intake_` namespace is an implementation detail of how two generations of
// forms share one table. It leaked onto the staff desk as case titles reading
// "Intake Pothole" (Blake 4.3). Residents were already protected by a private
// copy of this logic on the track page; these tests cover the shared one that
// replaced all of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { prettyFormKey, prettyKey } from './labels';

test('the intake_ namespace never reaches a human', () => {
  assert.equal(prettyFormKey('intake_pothole'), 'Pothole');
  assert.equal(prettyFormKey('intake_street_light'), 'Street Light');
  assert.equal(prettyFormKey('intake_illegal_dumping'), 'Illegal Dumping');
});

test('v1 keys lose their _report suffix too', () => {
  assert.equal(prettyFormKey('pothole_report'), 'Pothole');
  assert.equal(prettyFormKey('graffiti_report'), 'Graffiti');
});

test('a key carrying both affixes is stripped of both', () => {
  assert.equal(prettyFormKey('intake_pothole_report'), 'Pothole');
});

test('only a LEADING intake_ is stripped — the word survives mid-key', () => {
  assert.equal(prettyFormKey('voice_intake_note'), 'Voice Intake Note');
});

test('an already-clean key is left alone', () => {
  assert.equal(prettyFormKey('pothole'), 'Pothole');
  assert.equal(prettyFormKey('noise_complaint'), 'Noise Complaint');
});

test('empty and nullish keys degrade quietly instead of throwing', () => {
  assert.equal(prettyFormKey(''), '');
  assert.equal(prettyFormKey(undefined as any), '');
  assert.equal(prettyKey(null as any), '');
});

test('prettyKey formats field keys without touching form namespaces', () => {
  assert.equal(prettyKey('hazard_to_traffic'), 'Hazard To Traffic');
  assert.equal(prettyKey('location'), 'Location');
});
