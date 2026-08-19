// The static-map proxy is a public endpoint in front of a paid API — the parse
// step is the only thing between the internet and our Google bill, so it
// rejects everything that isn't exactly "lat,lon|lat,lon".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePins, pinsParam, staticMapUrl, MAX_PINS } from './staticmap';

describe('parsePins — strict or nothing', () => {
  it('round-trips what pinsParam produces', () => {
    const pins = [
      { lat: 40.796, lon: -89.61 },
      { lat: 40.712, lon: -89.594 },
    ];
    const parsed = parsePins(pinsParam(pins));
    assert.equal(parsed?.length, 2);
    assert.ok(Math.abs(parsed![0].lat - 40.796) < 1e-5);
    assert.ok(Math.abs(parsed![1].lon - -89.594) < 1e-5);
  });

  it('rejects junk, emptiness, and out-of-range coordinates', () => {
    assert.equal(parsePins(null), null);
    assert.equal(parsePins(''), null);
    assert.equal(parsePins('not,numbers'), null);
    assert.equal(parsePins('40.7'), null);
    assert.equal(parsePins('40.7,-89.6,12'), null);
    assert.equal(parsePins('91,-89.6'), null, 'latitude beyond 90');
    assert.equal(parsePins('40.7,-181'), null, 'longitude beyond 180');
    assert.equal(parsePins('40.7,-89.6|Infinity,0'), null);
  });

  it('caps the pin count at the alternates cap', () => {
    const many = Array.from({ length: MAX_PINS + 1 }, () => '40.7,-89.6').join('|');
    assert.equal(parsePins(many), null);
    const ok = Array.from({ length: MAX_PINS }, () => '40.7,-89.6').join('|');
    assert.equal(parsePins(ok)?.length, MAX_PINS);
  });
});

describe('staticMapUrl — lettered markers, nothing unvalidated', () => {
  it('a single pin is a confirmation map: fixed street-level zoom, no letter', () => {
    const url = new URL(staticMapUrl([{ lat: 40.692, lon: -89.589 }], 'test-key'));
    assert.equal(url.searchParams.get('zoom'), '15');
    const markers = url.searchParams.getAll('markers');
    assert.equal(markers.length, 1);
    assert.doesNotMatch(markers[0], /label:/, 'no letter when there is no choice');
  });

  it('labels markers A, B in candidate order and carries the key', () => {
    const url = new URL(
      staticMapUrl(
        [
          { lat: 40.796, lon: -89.61 },
          { lat: 40.712, lon: -89.594 },
        ],
        'test-key',
      ),
    );
    const markers = url.searchParams.getAll('markers');
    assert.equal(markers.length, 2);
    assert.match(markers[0], /^label:A\|40\.796/);
    assert.match(markers[1], /^label:B\|40\.712/);
    assert.equal(url.searchParams.get('key'), 'test-key');
    assert.equal(url.hostname, 'maps.googleapis.com');
  });
});
