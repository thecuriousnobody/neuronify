// The hard stop is the one piece of intake where a miss is not recoverable, so
// it gets the most adversarial tests in the repo. Two directions matter equally:
//
//   MISSES  — a real emergency that keeps being treated as a service request.
//   NOISE   — stopping so often that people learn to tap past the warning, which
//             is how a safety feature becomes decoration.
//
// Detection is deterministic and runs before the model, so these tests are the
// whole behaviour: there is no prompt to fall back on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectEmergency, type EmergencyKind } from './emergency';

function kindOf(text: string): EmergencyKind | null {
  return detectEmergency(text)?.kind ?? null;
}

test('a gas smell stops the conversation', () => {
  for (const text of [
    'I smell gas near the corner of 4th and Main',
    'There is a strong smell of gas outside my house',
    'gas leak on Elm Street',
    'smells like natural gas by the park',
    'rotten egg smell in the alley',
  ]) {
    assert.equal(kindOf(text), 'gas', `should stop: ${text}`);
  }
});

test('a downed line stops the conversation, even dressed as a tree report', () => {
  // This is the dangerous one: it arrives looking like tree_issue, and the
  // taxonomy would happily file it as one.
  for (const text of [
    'A tree came down and there are downed power lines across the road',
    'fallen wires in my yard',
    'the power line is arcing and sparking',
    'transformer on fire behind the school',
    'hanging electrical cable over the sidewalk',
  ]) {
    assert.equal(kindOf(text), 'power', `should stop: ${text}`);
  }
});

test('a water main break routes to the utility, not a queue', () => {
  for (const text of [
    'water main break on Sheridan',
    'the main burst and the street is filling up',
    'water shooting up out of the road',
  ]) {
    assert.equal(kindOf(text), 'water', `should stop: ${text}`);
  }
});

test('injury, fire and weapons go straight to 911', () => {
  for (const text of [
    'someone is hurt, they fell into the excavation',
    'a child is trapped in the storm drain',
    'house fire on Bradley Ave',
    'the building is collapsing',
    'we need an ambulance',
    'there was a shooting on my street',
    'my neighbour is not breathing',
  ]) {
    assert.equal(kindOf(text), 'life_safety', `should stop: ${text}`);
  }
});

test('ordinary 311 reports are NOT stopped', () => {
  // Every one of these contains a word that a naive matcher would trip on.
  for (const text of [
    'TEST — huge pothole at 4th and Main, right in the traffic lane',
    'the fire hydrant on my street is leaking a little',
    'someone parked in the fire lane again',
    'the street light is out on Elm',
    'water is pooling at the end of my driveway when it rains',
    'my water bill seems wrong, who do I talk to',
    'there is a downed tree branch blocking the sidewalk',
    'graffiti on the power box at the corner',
    'the storm drain is clogged with leaves',
    'a dead animal on the shoulder of Knoxville',
  ]) {
    assert.equal(kindOf(text), null, `should NOT stop: ${text}`);
  }
});

test('ruling something out does not trigger the stop', () => {
  for (const text of [
    'a tree is down but there are no downed wires',
    "I don't smell gas, just want to report the manhole cover",
    'nobody is hurt, the pothole just took out my tire',
    'the main is not broken, it is only surface water',
  ]) {
    assert.equal(kindOf(text), null, `negated, should NOT stop: ${text}`);
  }
});

test('a negation elsewhere in the sentence does not disarm a real emergency', () => {
  // The negation window is short on purpose: people qualify one thing and then
  // report another in the same breath.
  const m = detectEmergency('no parking sign is knocked over and a power line is down too');
  assert.equal(m?.kind, 'power', 'the second clause still stops the conversation');
});

test('the phrase that tripped it is reported, so a false stop is debuggable', () => {
  const m = detectEmergency('there is a gas leak at the corner');
  assert.ok(m);
  assert.match(m!.trigger, /gas leak/i);
});

test('911 is always offered, and no phone number is invented', () => {
  // Utility numbers vary per city; a wrong one in front of someone smelling gas
  // is worse than none. Unconfigured, the copy names the line without a number.
  for (const text of ['I smell gas', 'downed power lines', 'someone is hurt']) {
    const m = detectEmergency(text);
    assert.ok(m, text);
    assert.match(m!.message, /911/, 'every stop offers 911');
    assert.doesNotMatch(m!.message, /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/, 'no fabricated phone number');
  }
});

test('a configured utility number is used when one is supplied', () => {
  const m = detectEmergency('I smell gas', { gas: '1-800-555-0100' });
  assert.match(m!.message, /1-800-555-0100/);
  assert.match(m!.message, /911/, 'and 911 is still offered alongside it');
});

test('gas guidance leads with leaving, not with dialling', () => {
  // Telling someone to make a call inside a building full of gas is the wrong
  // order. If this copy is ever rewritten, it must still say leave first.
  const m = detectEmergency('I smell gas in my basement');
  const leave = m!.message.search(/leave the area/i);
  const call = m!.message.search(/call 911/i);
  assert.ok(leave >= 0 && call >= 0, 'both instructions present');
  assert.ok(leave < call, 'leaving comes before calling');
});

test('an acknowledged kind stops interrupting, but a new kind still stops', () => {
  // It breaks the flow; it does not wall the resident out of reporting.
  assert.equal(detectEmergency('I smell gas', {}, ['gas']), null, 'already warned about gas');
  assert.equal(
    detectEmergency('and there are downed power lines too', {}, ['gas'])?.kind,
    'power',
    'a different danger still stops them',
  );
});

test('empty and junk input is not an emergency', () => {
  assert.equal(detectEmergency(''), null);
  assert.equal(detectEmergency('   '), null);
  assert.equal(detectEmergency(undefined as any), null);
});

// ── Regressions from the 2026-08-07 adversarial review ───────────────────────

test('"shooting" is a WATER word here and must not fire 911 on its own', () => {
  // A hydrant, a sprinkler and a burst main all "shoot" water. A 911 card on
  // those is the noise that teaches people to tap past the real one.
  for (const text of [
    'the fire hydrant is shooting water into the street',
    'the sprinkler is shooting water across the sidewalk',
    'kids were shooting hoops in the road and a sign got knocked over',
    'there is water shooting out of the ground by the curb',
  ]) {
    assert.notEqual(detectEmergency(text)?.kind, 'life_safety', `must not read as a shooting: ${text}`);
  }
});

test('a real shooting still stops the conversation', () => {
  for (const text of [
    'there was a shooting on my street',
    'shots fired near the park',
    'I heard gunshots outside',
    'someone was shot at the corner',
    'active shooter at the school',
  ]) {
    assert.equal(kindOf(text), 'life_safety', `should stop: ${text}`);
  }
});

test('a negated water phrase cannot leak into a different pattern', () => {
  // The loop moves on after a negated match; the danger is the NEXT pattern
  // matching the same words with a clean negation window in front of it.
  const m = detectEmergency('I never saw anything like it, water shooting out of the road');
  assert.notEqual(m?.kind, 'life_safety', 'must not become a shooting report');
});

test('HEDGED reports are not silently swallowed', () => {
  // The most common way somebody reports a gas smell they aren't sure about.
  // A negator scan that runs through the comma finds "not", concludes they
  // ruled it out, and says nothing at all. That is the miss direction, and the
  // miss direction is the one that cannot be undone.
  assert.equal(kindOf("I'm not sure but I think I smell gas"), 'gas');
  assert.equal(kindOf("I'm not certain, but there's a gas leak smell near the meter"), 'gas');
  assert.equal(kindOf('there is nothing I can do, the house fire is spreading'), 'life_safety');
  assert.equal(kindOf('no one else is around and a power line is down'), 'power');
  assert.equal(kindOf("I don't know if it matters, but someone is hurt"), 'life_safety');
});

test('genuine same-clause negation still suppresses', () => {
  // The other direction must survive the clause-boundary fix.
  assert.equal(kindOf('a tree is down but there are no downed wires'), null);
  assert.equal(kindOf("I don't smell gas, just reporting the manhole cover"), null);
  assert.equal(kindOf('nobody is hurt, the pothole just took out my tire'), null);
});
