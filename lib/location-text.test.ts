import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinStillApplies } from './location-text';

test('a pin applies to the exact text it was resolved from', () => {
  assert.equal(pinStillApplies('Fry and Knoxville', 'Fry and Knoxville'), true);
});

test('case and spacing are not edits — the geocoder would return the same pin', () => {
  assert.equal(pinStillApplies('Fry and Knoxville', '  fry  and   KNOXVILLE '), true);
});

test('the wrong-dispatch case: an edited address drops the old pin', () => {
  // The whole reason this module exists. Text said one corner, pin sat at
  // another, and the record showed the pin's address to the crew.
  assert.equal(pinStillApplies('Fry and Knoxville', 'Main and Adams'), false);
});

test('a partial correction is still a correction', () => {
  assert.equal(pinStillApplies('400 Main St', '4000 Main St'), false);
});

test('emptying the field drops the pin', () => {
  assert.equal(pinStillApplies('Fry and Knoxville', ''), false);
  assert.equal(pinStillApplies('Fry and Knoxville', '   '), false);
});

test('fails closed when the pin has no recorded origin', () => {
  // A pin from before we tracked what produced it is not assumed good.
  assert.equal(pinStillApplies(undefined, 'Fry and Knoxville'), false);
  assert.equal(pinStillApplies(null, 'Fry and Knoxville'), false);
  assert.equal(pinStillApplies('', 'Fry and Knoxville'), false);
});

test('two empties are not a match', () => {
  assert.equal(pinStillApplies('', ''), false);
});
