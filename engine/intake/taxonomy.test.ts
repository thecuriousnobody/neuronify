// The taxonomy is pure data + pure functions — these tests pin the routing
// contract (constrain the category, derive the department) with no LLM at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES,
  FALLBACK_CATEGORY,
  resolveCategory,
  departmentFor,
  normalizeCity,
  CITY_DEPARTMENTS,
  TEMPLATE_CITY,
} from './taxonomy';

test('every category has a Peoria department (no gaps in the map)', () => {
  const peoria = CITY_DEPARTMENTS[TEMPLATE_CITY];
  for (const c of CATEGORIES) {
    assert.ok(peoria[c.key], `no department mapped for category "${c.key}"`);
  }
});

test('category keys are unique', () => {
  const keys = CATEGORIES.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate category key');
});

test('resolveCategory: exact key, exact label, and fail-safe', () => {
  assert.equal(resolveCategory('pothole'), 'pothole', 'exact key');
  assert.equal(resolveCategory('  Pothole  '), 'pothole', 'case-insensitive, trimmed');
  assert.equal(resolveCategory('Graffiti'), 'graffiti', 'key match wins on lowercased label');
  assert.equal(resolveCategory('Tall grass / weeds / overgrowth'), 'tall_grass_weeds', 'exact label');
  assert.equal(resolveCategory(''), FALLBACK_CATEGORY, 'empty → catch-all');
  assert.equal(resolveCategory('flying saucer landing'), FALLBACK_CATEGORY, 'unknown → catch-all');
});

test('departmentFor: Peoria routing, incl. divergences and the water route-out', () => {
  assert.equal(departmentFor('Peoria, IL', 'pothole'), 'public_works');
  assert.equal(departmentFor('Peoria, IL', 'graffiti'), 'police');
  assert.equal(departmentFor('Peoria, IL', 'tall_grass_weeds'), 'code_enforcement');
  assert.equal(departmentFor('Peoria, IL', 'rodent_pest'), 'code_enforcement', 'Peoria: rats → Code Enf.');
  assert.equal(departmentFor('Peoria, IL', 'park_maintenance'), 'parks_rec');
  assert.equal(departmentFor('Peoria, IL', 'water_sewer'), 'water_external', 'private utility — refer out');
  assert.equal(departmentFor('Peoria, IL', 'other_inquiry'), 'clerk');
});

test('normalizeCity strips the state and lowercases; empty → template', () => {
  assert.equal(normalizeCity('Peoria, IL'), 'peoria');
  assert.equal(normalizeCity('  PEORIA '), 'peoria');
  assert.equal(normalizeCity(''), TEMPLATE_CITY);
});

test('an unknown municipality falls back to the Peoria template', () => {
  // Peoria is the template a smaller municipality starts from.
  assert.equal(normalizeCity('Smallville, KS'), 'smallville');
  assert.equal(departmentFor('Smallville, KS', 'pothole'), 'public_works');
  assert.equal(departmentFor('Smallville, KS', 'graffiti'), 'police');
});
