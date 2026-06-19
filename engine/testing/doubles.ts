// Test doubles for the engine's ports. These live in the engine because they're
// part of how the engine is meant to be exercised; they pull in no app code.

import type { Clock, IdGenerator } from '../ports';

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
