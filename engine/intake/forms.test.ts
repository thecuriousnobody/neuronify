// Per-category form schemas — pin the shape so a data edit can't silently
// produce a form the conversation/verify step would choke on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CATEGORIES, type CategoryKey } from './taxonomy';
import { CATEGORY_FORMS, formForCategory, categoryFormKey, allCategoryForms } from './forms';

test('every category has a form, keyed <category>_report', () => {
  for (const c of CATEGORIES) {
    const form = CATEGORY_FORMS[c.key];
    assert.ok(form, `no form for ${c.key}`);
    assert.equal(form.key, categoryFormKey(c.key));
    assert.equal(form.key, `${c.key}_report`);
  }
  assert.equal(allCategoryForms().length, CATEGORIES.length);
});

test('every form has a required description; all but the catch-all require a location', () => {
  for (const c of CATEGORIES) {
    const form = formForCategory(c.key);
    const desc = form.fields.find((f) => f.key === 'description');
    assert.ok(desc?.required, `${c.key} must require description`);

    const loc = form.fields.find((f) => f.key === 'location');
    if (c.key === 'other_inquiry') {
      assert.equal(loc, undefined, 'catch-all is location-free');
    } else {
      assert.ok(loc?.required, `${c.key} must require location`);
      assert.equal(loc?.type, 'location');
    }
  }
});

test('photo-critical categories hard-require a photo; noise & catch-all have none', () => {
  const photoRequired: CategoryKey[] = [
    'pothole', 'graffiti', 'illegal_dumping', 'sidewalk_damage',
    'tall_grass_weeds', 'property_maintenance', 'abandoned_vehicle', 'vacant_abandoned_property',
  ];
  for (const key of photoRequired) {
    const photo = formForCategory(key).fields.find((f) => f.key === 'photo');
    assert.ok(photo, `${key} should have a photo field`);
    assert.equal(photo?.required, true, `${key} photo must be required`);
    assert.equal(photo?.requiresAttachment, true);
  }
  for (const key of ['noise_complaint', 'other_inquiry'] as CategoryKey[]) {
    const photo = formForCategory(key).fields.find((f) => f.key === 'photo');
    assert.equal(photo, undefined, `${key} should have no photo field`);
  }
});

test('every choice field carries a non-empty choices list', () => {
  for (const c of CATEGORIES) {
    for (const f of formForCategory(c.key).fields) {
      if (f.type === 'choice') {
        assert.ok(Array.isArray(f.choices) && f.choices.length > 0, `${c.key}.${f.key} needs choices`);
      }
    }
  }
});

test('field keys are unique within each form', () => {
  for (const c of CATEGORIES) {
    const keys = formForCategory(c.key).fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, `${c.key} has a duplicate field key`);
  }
});

test('the category-specific guidance survives (spot-check pothole size)', () => {
  const size = formForCategory('pothole').fields.find((f) => f.key === 'size');
  assert.deepEqual(size?.choices, ['small', 'medium', 'large']);
  assert.match(size?.prompt ?? '', /dinner plate/, 'plain-language size guidance is present');
});
