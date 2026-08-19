// The Rome, IL incident (2026-07-31): "Pioneer Parkway and University, north
// side median" geocoded to "North St, Rome, IL 61523" — 15 miles out of town,
// stored on a real Public Works record. Two defenses, both tested here:
// descriptor stripping before the query, and out-of-city rejection after.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocation, matchInCity, pickCandidates, isPinnablePlace, intersectionVariants } from './geocode';

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

describe('pickCandidates — in-city, deduped, capped, order kept', () => {
  const CITY = 'Peoria, IL';
  const mk = (matched: string) => ({ matched, lat: 40.69, lon: -89.59 });

  it('filters out-of-city, dedupes case-insensitively, caps at 4', () => {
    const out = pickCandidates(
      [
        mk('Pioneer Pkwy & N University St, Peoria, IL 61614, USA'),
        mk('North St, Rome, IL 61523, USA'), // drift — dropped
        mk('PIONEER PKWY & N UNIVERSITY ST, PEORIA, IL 61614, USA'), // dupe
        mk('A St, Peoria, IL, USA'),
        mk('B St, Peoria, IL, USA'),
        mk('C St, Peoria, IL, USA'),
        mk('D St, Peoria, IL, USA'), // over the cap
      ],
      CITY,
    );
    assert.equal(out.length, 4);
    assert.equal(out[0].matched, 'Pioneer Pkwy & N University St, Peoria, IL 61614, USA');
    assert.ok(!out.some((m) => /Rome/.test(m.matched)));
  });

  it('empty in → empty out', () => {
    assert.deepEqual(pickCandidates([], CITY), []);
  });
});

// Found while testing the review-screen re-pin (2026-08-08): typing a phrase
// Google can't place ("behind the big oak tree by the creek") returned
// "Peoria, IL" — the city centroid — and the review screen presented it as
// "this is where the crew will go". A shrug that looks like a match.
describe('isPinnablePlace — a region is not a location', () => {
  it('rejects the city centroid, which is what an unplaceable phrase falls back to', () => {
    assert.equal(isPinnablePlace(['locality', 'political']), false);
  });

  it('rejects ZIP, county and state centroids for the same reason', () => {
    assert.equal(isPinnablePlace(['postal_code']), false);
    assert.equal(isPinnablePlace(['administrative_area_level_2', 'political']), false);
    assert.equal(isPinnablePlace(['administrative_area_level_1', 'political']), false);
  });

  it('keeps every shape a crew could actually drive to', () => {
    assert.equal(isPinnablePlace(['intersection']), true);
    assert.equal(isPinnablePlace(['street_address']), true);
    assert.equal(isPinnablePlace(['route']), true);
    assert.equal(isPinnablePlace(['premise']), true);
    assert.equal(isPinnablePlace(['park', 'establishment', 'point_of_interest']), true);
  });

  it('a street address in a locality is still a street address', () => {
    // Only the coarse types are disqualifying; they never ride along with a
    // street-level result, but be explicit about which way the test points.
    assert.equal(isPinnablePlace(['street_address', 'political']), true);
  });

  it('does not over-reject an unknown or missing type list', () => {
    assert.equal(isPinnablePlace(undefined), true);
    assert.equal(isPinnablePlace([]), true);
    assert.equal(isPinnablePlace(['something_new_from_google']), true);
  });
});

describe('intersectionVariants — both word orders survive to the geocoder', () => {
  // Finding 5 (2026-08-18): two Knoxville/Frye intersections ~5.8 miles apart.
  // Probed live: "Knoxville and Frye" → 2 candidates, "Frye and Knoxville" → 1.
  // The resident's word order must not silently decide which corners exist.

  it('an "A and B" intersection also queries "B and A", plus both orders bare of street-type suffixes', () => {
    // Rajeev guessed "Avenue"; the corner he meant is on N Frye RD. The suffix
    // is the resident's guess, not knowledge — it must not veto a corner.
    assert.deepEqual(intersectionVariants('Frye Avenue and Knoxville Avenue'), [
      'Frye Avenue and Knoxville Avenue',
      'Knoxville Avenue and Frye Avenue',
      'Frye and Knoxville',
      'Knoxville and Frye',
    ]);
  });

  it('suffix-free streets add no bare variants (no duplicate queries)', () => {
    assert.deepEqual(intersectionVariants('Fry and Knoxville'), ['Fry and Knoxville', 'Knoxville and Fry']);
  });

  it('ampersand form swaps too', () => {
    assert.deepEqual(intersectionVariants('Fry & Knoxville'), ['Fry & Knoxville', 'Knoxville and Fry']);
  });

  it('a plain address is left alone', () => {
    assert.deepEqual(intersectionVariants('1200 E Glen Ave'), ['1200 E Glen Ave']);
  });

  it('a comma-bearing phrase is never swapped into nonsense', () => {
    assert.deepEqual(intersectionVariants('Fry and Knoxville, Peoria'), ['Fry and Knoxville, Peoria']);
  });

  it('a multi-word street swaps cleanly at the separator, bare variants included', () => {
    assert.deepEqual(intersectionVariants('Pioneer Parkway and University'), [
      'Pioneer Parkway and University',
      'University and Pioneer Parkway',
      'Pioneer and University',
      'University and Pioneer',
    ]);
  });
});
