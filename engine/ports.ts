// Neuronify engine — ports.
//
// The interfaces the outside world must implement for the engine to run. The
// engine depends ONLY on these, never on a concrete DB / clock / model / mailer.
// The Next.js app wires up adapters (Neon, system clock, lib/ai.ts, a notifier).
// Tests wire up in-memory + fake-clock adapters. See ./README.md.

import type {
  AuditEvent,
  CommunicationIntent,
  FormDefinition,
  Submission,
  WorkflowDefinition,
} from './domain/types';

/**
 * Time is a dependency. The engine never calls Date.now() — it asks the Clock.
 * Critical because external/internal step timing is a core feature, and tests
 * need to advance time deterministically.
 */
export interface Clock {
  /** Current instant as an ISO-8601 string. */
  now(): string;
}

/** Generates ids for new records/events. Injected so tests stay deterministic. */
export interface IdGenerator {
  next(): string;
}

/**
 * Persistence — a pure data boundary. Note what's MISSING: there is no
 * save/get for a WorkflowInstance. The instance is never stored; it is always
 * DERIVED from the event log (`deriveInstance`). The audit log is the source of
 * truth. Definitions are read-mostly; submissions are write-once; events are
 * append-only (no update, no delete).
 */
export interface Repository {
  // — Definitions (templates). Omitting `version` returns the latest. —
  getFormDefinition(key: string, version?: number): Promise<FormDefinition | null>;
  getWorkflowDefinition(key: string, version?: number): Promise<WorkflowDefinition | null>;

  // — Submissions (the Record of Truth root) —
  saveSubmission(submission: Submission): Promise<void>;
  getSubmission(id: string): Promise<Submission | null>;

  // — Audit ledger (append-only). getEvents returns them in insertion order. —
  appendEvents(events: AuditEvent[]): Promise<void>;
  getEvents(submissionId: string): Promise<AuditEvent[]>;

  // — Queue support: submissions with an open workflow (opened, not closed). —
  // Derive-on-read feeds the approver queue; a materialized index can come later.
  listOpenSubmissionIds(): Promise<string[]>;

  // — All submissions (any status). Feeds the operator metrics aggregation. —
  listAllSubmissionIds(): Promise<string[]>;
}

/** Delivers a communication to the submitter. The "relay", made concrete. */
export interface Notifier {
  send(intent: CommunicationIntent): Promise<void>;
}

/** The LLM behind the intake conversation. Adapter wraps lib/ai.ts in the app. */
export interface LLM {
  complete(args: { system: string; user: string; maxTokens?: number }): Promise<string>;
}

/** Everything the engine's use-cases need, bundled. */
export interface EngineEnv {
  clock: Clock;
  ids: IdGenerator;
  repo: Repository;
  notifier: Notifier;
  llm: LLM;
}
