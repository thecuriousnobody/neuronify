// Test doubles for the engine's ports. These live in the engine because they're
// part of how the engine is meant to be exercised; they pull in no app code.

import type { Clock, IdGenerator, LLM } from '../ports';

/** A clock you control. `advance` moves it forward; `now` formats ISO. */
export class FakeClock implements Clock {
  private ms: number;
  constructor(startMs = 0) {
    this.ms = startMs;
  }
  now(): string {
    return new Date(this.ms).toISOString();
  }
  advance(ms: number): this {
    this.ms += ms;
    return this;
  }
}

/** Deterministic, monotonic ids: "id-1", "id-2", ... */
export class SeqIds implements IdGenerator {
  private n = 0;
  constructor(private prefix = 'id') {}
  next(): string {
    return `${this.prefix}-${++this.n}`;
  }
}

/**
 * An LLM that returns pre-scripted responses in order — no network, fully
 * deterministic. Each `complete()` call dequeues the next canned string;
 * `calls` records what it was asked so tests can assert on prompts.
 */
export class ScriptedLLM implements LLM {
  private queue: string[];
  readonly calls: { system: string; user: string }[] = [];
  constructor(responses: string[]) {
    this.queue = [...responses];
  }
  async complete(args: { system: string; user: string; maxTokens?: number }): Promise<string> {
    this.calls.push({ system: args.system, user: args.user });
    if (this.queue.length === 0) throw new Error('ScriptedLLM: no more responses queued');
    return this.queue.shift()!;
  }
}
