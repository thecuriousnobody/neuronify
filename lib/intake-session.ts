// A handle on ONE conversation, so its turns can be ordered into a funnel.
//
// This is not an identity and must never become one. It lives in
// sessionStorage, which means it dies when the tab closes: a resident who files
// twice from the same phone produces two unrelated ids, and nothing in the
// system can tell that it was the same person. That is the point. We want to
// know "people abandon this category at question three", not "this person
// abandoned".
//
// Contrast lib/report-memory.ts, which uses localStorage deliberately — that
// one has to survive the tab closing, because it is the resident's way back to
// their report. This one has to NOT survive it.
//
// Fails soft like everything else that touches browser storage: no id is a
// perfectly acceptable outcome, and the server simply doesn't record the turn.
// Telemetry is never worth an error in front of a resident.

const KEY = 'nf_intake_session';

/**
 * The current conversation's id, minting one on first use. Returns '' when
 * storage is unavailable (private mode, blocked cookies, server render) — the
 * caller sends nothing and the turn goes unrecorded.
 */
export function intakeSessionId(): string {
  try {
    const s = globalThis.sessionStorage;
    if (!s) return '';
    const existing = s.getItem(KEY);
    if (existing) return existing;
    const id = mintId();
    s.setItem(KEY, id);
    return id;
  } catch {
    return '';
  }
}

/** Start a fresh conversation. Called once a report is filed, so the next
 *  report from this tab is counted as its own funnel rather than a very long
 *  one. */
export function resetIntakeSession(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // Nothing to do and nothing worth saying.
  }
}

/** Random, opaque, and not derived from anything about the device or person.
 *  randomUUID needs a secure context, so there is a plain-random fallback —
 *  collisions only blur one funnel row, they cannot mix up a report. */
function mintId(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // fall through
  }
  return `s-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
