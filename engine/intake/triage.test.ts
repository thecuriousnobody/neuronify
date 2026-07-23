// Category-first triage: the model proposes, the engine constrains. A category
// locks only on a known taxonomy key; vague or garbage answers keep listening.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { discernCategory } from './triage';
import type { ChatMessage } from './conversation';
import { ScriptedLLM } from '../testing/doubles';

const CITY = 'Peoria, IL';
const noHistory: ChatMessage[] = [];

test('a clear description locks the category', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({
      reply: "Got it — sounds like a pothole. Where is it?",
      category: 'pothole',
      rationale: 'Resident describes a hole in the road surface.',
    }),
  ]);
  const turn = await discernCategory(llm, CITY, noHistory, 'There is a big hole in the road on Main St');
  assert.equal(turn.category, 'pothole');
  assert.match(turn.reply, /where/i, 'hands off by asking for the first detail');
});

test('a vague message keeps listening (category stays null)', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({
      reply: 'Happy to help — can you tell me a bit more about what you noticed?',
      category: 'unclear',
      rationale: 'Not enough detail to categorize yet.',
    }),
  ]);
  const turn = await discernCategory(llm, CITY, noHistory, 'something is wrong near my house');
  assert.equal(turn.category, null, '"unclear" does not lock a category');
  assert.ok(turn.reply.length > 0, 'asks a clarifying question');
});

test('a hallucinated category is treated as "keep listening", not accepted', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: '...', category: 'ministry_of_potholes', rationale: 'x' }),
  ]);
  const turn = await discernCategory(llm, CITY, noHistory, 'the thing is broken');
  assert.equal(turn.category, null, 'an unknown key never locks the conversation');
});

test('the model may explicitly settle on the catch-all category', async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({ reply: 'Let me pass this to the city clerk.', category: 'other_inquiry', rationale: 'General question.' }),
  ]);
  const turn = await discernCategory(llm, CITY, noHistory, 'who is my alderman?');
  assert.equal(turn.category, 'other_inquiry', 'other_inquiry is a valid terminal category');
});
