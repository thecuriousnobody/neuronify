import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  rememberReport,
  rememberedReports,
  forgetReports,
  canRemember,
  type RememberedReport,
} from './report-memory';

// A localStorage that behaves. `fail` flips it into the browser states that
// matter: private mode (setItem throws), blocked cookies (access throws).
function fakeStore(fail?: 'write' | 'read') {
  const map = new Map<string, string>();
  return {
    getItem(k: string) {
      if (fail === 'read') throw new Error('SecurityError');
      return map.has(k) ? map.get(k)! : null;
    },
    setItem(k: string, v: string) {
      if (fail === 'write') throw new Error('QuotaExceededError');
      map.set(k, v);
    },
    removeItem(k: string) {
      if (fail === 'write') throw new Error('QuotaExceededError');
      map.delete(k);
    },
    get raw() {
      return map;
    },
  };
}

function install(s: unknown) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: s,
    configurable: true,
    writable: true,
  });
}

const rec = (id: string, over: Partial<RememberedReport> = {}): RememberedReport => ({
  id,
  category: 'pothole',
  department: 'public_works',
  filedAt: '2026-08-10T12:00:00.000Z',
  ...over,
});

beforeEach(() => install(fakeStore()));

test('a filed report comes back', () => {
  assert.equal(rememberReport(rec('abc')), true);
  assert.deepEqual(rememberedReports(), [rec('abc')]);
});

test('newest first — the whole point of the list', () => {
  rememberReport(rec('one'));
  rememberReport(rec('two'));
  rememberReport(rec('three'));
  assert.deepEqual(
    rememberedReports().map((r) => r.id),
    ['three', 'two', 'one'],
  );
});

test('re-filing the same id moves it up instead of duplicating', () => {
  rememberReport(rec('one'));
  rememberReport(rec('two'));
  rememberReport(rec('one', { category: 'street_light' }));
  const ids = rememberedReports().map((r) => r.id);
  assert.deepEqual(ids, ['one', 'two']);
  assert.equal(rememberedReports()[0].category, 'street_light');
});

test('the list is capped — a shared device is not a filing history', () => {
  for (let i = 0; i < 30; i++) rememberReport(rec(`r${i}`));
  const got = rememberedReports();
  assert.equal(got.length, 20);
  assert.equal(got[0].id, 'r29');
  assert.equal(got[19].id, 'r10');
});

test('an optional matched address rides along; absent stays absent', () => {
  rememberReport(rec('withPin', { matched: 'N Knoxville Ave & W Frye Ave, Peoria, IL' }));
  rememberReport(rec('noPin'));
  const [noPin, withPin] = rememberedReports();
  assert.equal(withPin.matched, 'N Knoxville Ave & W Frye Ave, Peoria, IL');
  assert.equal('matched' in noPin, false);
});

test('forgetting empties the device list', () => {
  rememberReport(rec('one'));
  assert.equal(forgetReports(), true);
  assert.deepEqual(rememberedReports(), []);
});

// ── failing soft ──
//
// Every one of these is a real browser. None may throw: this module is called
// from inside the filing path, and a storage failure must never cost someone
// their report.

test('no storage at all (server render, private-mode-ish): no-ops, never throws', () => {
  install(undefined);
  assert.equal(rememberReport(rec('abc')), false);
  assert.deepEqual(rememberedReports(), []);
  assert.equal(forgetReports(), false);
  assert.equal(canRemember(), false);
});

test('a store whose writes throw reports failure rather than exploding', () => {
  install(fakeStore('write'));
  assert.equal(rememberReport(rec('abc')), false);
  assert.equal(forgetReports(), false);
  assert.equal(canRemember(), false);
});

test('a store whose reads throw returns an empty list', () => {
  install(fakeStore('read'));
  assert.deepEqual(rememberedReports(), []);
});

test('storage that throws on property access is treated as absent', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    get() {
      throw new Error('SecurityError: cookies blocked');
    },
    configurable: true,
  });
  assert.deepEqual(rememberedReports(), []);
  assert.equal(rememberReport(rec('abc')), false);
});

// ── untrusted disk ──

test('garbage on disk reads as an empty list, not a crash', () => {
  const s = fakeStore();
  install(s);
  s.raw.set('nf_reports_v1', 'not json at all');
  assert.deepEqual(rememberedReports(), []);
});

test('a non-array value reads as empty', () => {
  const s = fakeStore();
  install(s);
  s.raw.set('nf_reports_v1', JSON.stringify({ id: 'abc' }));
  assert.deepEqual(rememberedReports(), []);
});

test('malformed entries are dropped, good ones survive alongside them', () => {
  const s = fakeStore();
  install(s);
  s.raw.set(
    'nf_reports_v1',
    JSON.stringify([
      null,
      'a string',
      { id: '' },
      { id: '   ' },
      { category: 'pothole' }, // no id — unopenable, so worthless
      { id: 'good', category: 'pothole', department: 'public_works', filedAt: '2026-08-10T12:00:00.000Z' },
      { id: 'good' }, // duplicate id
      { id: 'partial' }, // openable; missing fields degrade to empty strings
    ]),
  );
  const got = rememberedReports();
  assert.deepEqual(
    got.map((r) => r.id),
    ['good', 'partial'],
  );
  assert.deepEqual(got[1], { id: 'partial', category: '', department: '', filedAt: '' });
});

test('a report with no id is never written — it could not be opened again', () => {
  assert.equal(rememberReport(rec('')), false);
  assert.equal(rememberReport(rec('   ')), false);
  assert.deepEqual(rememberedReports(), []);
});

test('canRemember is true on a working store and leaves nothing behind', () => {
  const s = fakeStore();
  install(s);
  assert.equal(canRemember(), true);
  assert.equal(s.raw.size, 0);
});
