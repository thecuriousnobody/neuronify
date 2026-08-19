// Labels for ambiguous pins must be things a resident actually holds
// (Finding 7): a landmark, else a plain direction — a formal street name only
// when two labels would otherwise collide and something must tell them apart.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { areaLabel, pickLandmarkName, dedupeLabels } from './landmarks';

const CITY = 'Peoria, IL';

describe('areaLabel — always produces something a resident can read', () => {
  it('the two Knoxville/Frye corners get different, plain answers', () => {
    // N Frye Rd corner (40.796) is well north; E Frye Ave corner (40.712) is
    // ~2km from the Main/Adams core — north of downtown but "north Peoria" to
    // anyone describing it.
    assert.equal(areaLabel(40.796, -89.61, CITY), 'north Peoria');
    assert.equal(areaLabel(40.712, -89.594, CITY), 'north Peoria');
    // …which is exactly why dedupeLabels exists (below).
  });

  it('the downtown core reads as downtown', () => {
    assert.equal(areaLabel(40.6918, -89.5896, CITY), 'near downtown Peoria');
  });

  it('east/west split works and an unknown city degrades to its name', () => {
    assert.equal(areaLabel(40.694, -89.52, CITY), 'east Peoria');
    assert.equal(areaLabel(40.694, -89.66, CITY), 'west Peoria');
    assert.equal(areaLabel(40.7, -89.6, 'Springfield, IL'), 'Springfield');
  });
});

describe('pickLandmarkName — landmarks, not addresses', () => {
  it('takes the first named place and skips street-address "names"', () => {
    assert.equal(
      pickLandmarkName([
        { name: '4700 N Knoxville Ave' },
        { name: 'Northwoods Mall' },
        { name: 'Exposition Gardens' },
      ]),
      'Northwoods Mall',
    );
  });

  it('null on garbage or emptiness', () => {
    assert.equal(pickLandmarkName(undefined), null);
    assert.equal(pickLandmarkName([]), null);
    assert.equal(pickLandmarkName([{ notAName: true }, { name: '  ' }]), null);
  });
});

describe('dedupeLabels — identical labels tell the resident nothing', () => {
  it('collisions fall back to the cleaned street name; distinct labels stay', () => {
    const out = dedupeLabels([
      { matched: 'N Frye Rd & Knoxville Ave, Peoria, IL 61615, USA', lat: 40.796, lon: -89.61, label: 'north Peoria' },
      { matched: 'Knoxville Ave & E Frye Ave, Peoria, IL 61604, USA', lat: 40.712, lon: -89.594, label: 'north Peoria' },
    ]);
    assert.deepEqual(
      out.map((c) => c.label),
      ['N Frye Rd & Knoxville Ave, Peoria, IL 61615', 'Knoxville Ave & E Frye Ave, Peoria, IL 61604'],
      'both fall back to distinct street names, ", USA" stripped',
    );

    const kept = dedupeLabels([
      { matched: 'A, USA', lat: 1, lon: 1, label: 'near Northwoods Mall' },
      { matched: 'B, USA', lat: 2, lon: 2, label: 'near Bradley University' },
    ]);
    assert.deepEqual(kept.map((c) => c.label), ['near Northwoods Mall', 'near Bradley University']);
  });
});
