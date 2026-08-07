// Guards the limiter that sits in front of every public endpoint. It had no
// tests at all until 2026-08-07, and the bug that prompted these was a UX bug,
// not a security one: one shared per-IP counter meant dictating a message and
// then sending it counted as two calls 200ms apart, so normal use was throttled
// (Blake 1.4). The point of these tests is that buckets stay independent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rateLimit, resetRateLimits } from './ratelimit';

const IP = '203.0.113.7';

test('spacing out calls is always allowed', () => {
  resetRateLimits();
  assert.equal(rateLimit(IP, 'chat', 0).ok, true, 'first call');
  assert.equal(rateLimit(IP, 'chat', 5_000).ok, true, 'well after the gap');
  assert.equal(rateLimit(IP, 'chat', 10_000).ok, true);
});

test('two calls inside the minimum gap are refused, with the "too fast" reason', () => {
  resetRateLimits();
  assert.equal(rateLimit(IP, 'submit', 0).ok, true);
  const second = rateLimit(IP, 'submit', 100);
  assert.equal(second.ok, false);
  assert.match(second.reason ?? '', /Too fast/i);
});

test('dictating then sending does NOT trip the limiter (Blake 1.4)', () => {
  // The exact sequence a resident performs on a phone: speak, transcription
  // returns, hit send. Two different endpoints, ~200ms apart. This used to 429.
  resetRateLimits();
  assert.equal(rateLimit(IP, 'voice', 0).ok, true, 'transcription request');
  const send = rateLimit(IP, 'chat', 200);
  assert.equal(send.ok, true, 'sending straight after dictation must be allowed');
});

test('a refused call does not count against the window', () => {
  // Otherwise a resident hammering send while throttled would lock themselves
  // out for a full minute.
  resetRateLimits();
  rateLimit(IP, 'submit', 0);
  for (let i = 1; i <= 10; i++) assert.equal(rateLimit(IP, 'submit', 100).ok, false);
  assert.equal(rateLimit(IP, 'submit', 2_000).ok, true, 'still allowed once the gap passes');
});

test('the per-window ceiling holds, then releases as the window slides', () => {
  resetRateLimits();
  // 'desk' allows 10 per minute; space them past the 1s gap.
  for (let i = 0; i < 10; i++) {
    assert.equal(rateLimit(IP, 'desk', i * 2_000).ok, true, `call ${i + 1} within the ceiling`);
  }
  const over = rateLimit(IP, 'desk', 20_000);
  assert.equal(over.ok, false, '11th call in the window is refused');
  assert.match(over.reason ?? '', /Too many/i);

  // The first call ages out 60s after it was made.
  assert.equal(rateLimit(IP, 'desk', 61_000).ok, true, 'window slid, capacity returned');
});

test('buckets are independent — a strict one cannot throttle a lenient one', () => {
  resetRateLimits();
  for (let i = 0; i < 20; i++) rateLimit(IP, 'submit', i * 2_000);
  assert.equal(rateLimit(IP, 'submit', 40_000).ok, false, 'submit is exhausted');
  assert.equal(rateLimit(IP, 'chat', 40_000).ok, true, 'chat is unaffected');
});

test('one resident being throttled does not affect another IP', () => {
  resetRateLimits();
  rateLimit(IP, 'submit', 0);
  assert.equal(rateLimit(IP, 'submit', 100).ok, false);
  assert.equal(rateLimit('198.51.100.4', 'submit', 100).ok, true, 'limits are per IP');
});

test('an unknown bucket falls back to the strict default rather than to no limit', () => {
  resetRateLimits();
  assert.equal(rateLimit(IP, 'nonsense' as any, 0).ok, true);
  assert.equal(rateLimit(IP, 'nonsense' as any, 100).ok, false, 'fails closed, not open');
});
