// App-side adapters for the engine's remaining ports: a real clock, UUID ids,
// an outbox notifier, and the LLM bridged to the existing provider-agnostic
// lib/ai.ts. (The engine forbids Date.now()/crypto here — these adapters are on
// the app side, where using them is correct.)

import type { Clock, CommunicationIntent, IdGenerator, LLM, Notifier } from '@/engine';
import { callLLM } from '@/lib/ai';
import { getSql } from '@/lib/db';

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export const uuidIds: IdGenerator = {
  next: () => crypto.randomUUID(),
};

/**
 * Outbox notifier: persist the communication intent for a delivery worker to
 * pick up later (Phase 4). Emission is decoupled from delivery, which keeps the
 * engine's "relay, never do the work" promise honest even under failure.
 */
export const outboxNotifier: Notifier = {
  async send(intent: CommunicationIntent): Promise<void> {
    const sql = getSql();
    await sql`
      insert into nf_communications (submission_id, reason, message)
      values (${intent.submissionId}, ${intent.reason}, ${intent.message})
    `;
  },
};

/** Bridge the engine's LLM port to the existing multi-provider client. */
export const aiLLM: LLM = {
  complete: ({ system, user, maxTokens }) =>
    callLLM({ system, user, model: process.env.AGENT_INTAKE_MODEL || 'qwen/qwen3-32b', maxTokens }),
};
