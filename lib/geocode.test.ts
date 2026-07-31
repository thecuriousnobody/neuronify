// The Rome, IL incident (2026-07-31): "Pioneer Parkway and University, north
// side median" geocoded to "North St, Rome, IL 61523" — 15 miles out of town,
// stored on a real Public Works record. Two defenses, both tested here:
// descriptor stripping before the query, and out-of-city rejection after.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocation, matchInCity } from './geocode';

describe('normalizeLocation — descriptors out, street names intact', () => {
  it('strips "north side median" (the Rome trigger) but keeps the intersection', () => {
    assert.equal(
      normalizeLocation('Pioneer Parkway and University, north side median'),
      'Pioneer Parkway and University',
    );
  });

  it('keeps directional STREET names — North University St is a real street', () => {
    assert.equal(
      normalizeLocation('North University Street and West Nebraska Ave'),
      'North University Street and West Nebraska Ave',
    );
  });

  it('strips bound/end compounds and lone descriptors', () => {
    assert.equal(normalizeLocation('I-74 westbound shoulder near exit 92'), 'I-74 exit 92');
    assert.equal(normalizeLocation('the intersection of Fry and Knoxville'), 'Fry and Knoxville');
  });

  it('cleans comma debris left by stripping', () => {
    assert.equal(normalizeLocation('Main St, median, Peoria'), 'Main St, Peoria');
  });
});

describe('matchInCity — no pin beats a wrong pin', () => {
  const CITY = 'Peoria, IL';

  it('accepts Peoria and Peoria Heights', () => {
    assert.equal(matchInCity('Knoxville Ave & E Frye Ave, Peoria, IL 61604, USA', CITY), true);
    assert.equal(matchInCity('1200 E Glen Ave, Peoria Heights, IL 61616, USA', CITY), true);
  });

  it('rejects the Rome drift', () => {
    assert.equal(matchInCity('North St, Rome, IL 61523, USA', CITY), false);
  });

  it('rejects other-state lookalikes', () => {
    assert.equal(matchInCity('Main St, Bloomington, IL 61701, USA', CITY), false);
  });
});
