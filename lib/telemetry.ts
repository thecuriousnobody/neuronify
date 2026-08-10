// Where the intake loses people.
//
// Before this, an abandoned conversation left no trace anywhere in the system:
// /api/v2/converse ran no SQL at all, so a resident who got confused at
// question three and closed the tab was indistinguishable from one who never
// showed up. Every number we had described the people who made it to the end —
// the survivors — which is the one group whose experience needs no fixing.
//
// Two rules, and they are the whole design.
//
// 1. SHAPE, NEVER CONTENT. This records that a turn happened, what kind of
//    report it was about, and which field KEYS were still unanswered. Never
//    what the resident said, never a field value, never coordinates, never an
//    IP, never a user agent. A filed report already keeps its transcript with
//    the record it belongs to; an abandoned one is not worth building a second,
//    quieter archive of people's words nobody consented to file.
//
// 2. IT CAN NEVER COST SOMEONE THEIR REPORT. Same discipline as
//    lib/report-memory.ts. Every write is swallowed whole — a telemetry
//    failure, a missing table, a dead database must be invisible to the
//    resident. Nothing in here is allowed to throw, ever.

import { getSql } from '@/lib/db';

/** What happened. Deliberately a closed set — a free-text event name is how a
 *  telemetry table turns into a log of whatever anyone felt like recording. */
export type IntakeEvent = 'triage' | 'collecting' | 'filed';

export type IntakeTelemetry = {
  sessionId: string;
  event: IntakeEvent;
  city?: string | null;
  category?: string | null;
  department?: string | null;
  /** Resident messages so far — the x-axis of the drop-off curve. */
  turn?: number | null;
  ready?: boolean | null;
  /** Field keys still unanswered. Keys only. Never the answers. */
  missing?: string[];
};

const EVENTS = new Set<IntakeEvent>(['triage', 'collecting', 'filed']);

/** Session ids come from the client, so they are untrusted input like any other
 *  body field: bounded, and never interpolated anywhere but a parameter. */
const MAX_SESSION_ID = 64;
const MAX_MISSING = 40;
const MAX_KEY = 64;

/**
 * Record one intake turn. Fire-and-forget by contract: awaited so the serverless
 * instance doesn't die mid-write, but it resolves even when everything is
 * broken. Callers do not need to guard it and must not branch on it.
 */
export async function logIntake(t: IntakeTelemetry): Promise<void> {
  try {
    const sessionId = String(t.sessionId ?? '').trim().slice(0, MAX_SESSION_ID);
    // No session, no funnel — a row that can't be ordered into a conversation
    // is noise, and writing it anyway is how a telemetry table gets a reputation.
    if (!sessionId) return;
    if (!EVENTS.has(t.event)) return;

    const missing = (Array.isArray(t.missing) ? t.missing : [])
      .filter((k): k is string => typeof k === 'string')
      .map((k) => k.slice(0, MAX_KEY))
      .slice(0, MAX_MISSING);

    const sql = getSql();
    await sql`
      insert into nf_intake_telemetry (session_id, event, city, category, department, turn, ready, missing)
      values (
        ${sessionId}, ${t.event}, ${t.city ?? null}, ${t.category ?? null},
        ${t.department ?? null}, ${t.turn ?? null}, ${t.ready ?? null}, ${missing}
      )`;
  } catch {
    // Deliberately silent, including the "table doesn't exist yet" case: this
    // code ships before the migration runs, and a resident filing a report is
    // not the right person to find out about it.
  }
}

/**
 * The session id as it arrives from the client. Untrusted: bounded and stripped
 * to an id-shaped string, because it is written to a table and read back into
 * dashboards.
 */
export function cleanSessionId(raw: unknown): string {
  // Strings only. Coercing would turn `{}` into "[object Object]" and then into
  // the id "objectObject" — every malformed client collapsing onto one shared
  // session, which reads as one very confused resident.
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, MAX_SESSION_ID);
}

/** How many turns the resident has taken, from the history they echo back.
 *  Their own messages only — the agent's replies are not their effort. */
export function turnCount(history: { role: string }[] | undefined | null): number {
  if (!Array.isArray(history)) return 0;
  return history.filter((m) => m?.role === 'user').length;
}
