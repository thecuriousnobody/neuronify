// The device remembers which reports were filed from it.
//
// The intake is anonymous by design, so the city has no way to reach the
// resident, which forces the only handle on a report onto the resident's side.
// Today that handle is a 36-character UUID printed on the done screen and
// nowhere else — nobody transcribes that. This module is the other end: the
// browser keeps a short list of what it filed, so /track can be an index
// instead of a 404.
//
// Two rules shape everything here.
//
// 1. It records what the report WAS, never what was SAID. No description, no
//    transcript, no photo, no address the resident typed. `matched` is the
//    geocoder's answer — a public street corner — and is fine. This sits
//    unencrypted on a device that may be shared or borrowed.
//
// 2. It fails soft, always. Private mode, disabled storage, a full quota, a
//    corrupted value someone hand-edited — every one of those has to be a
//    silent no-op. A storage failure must never cost someone their report, and
//    this module is called from inside the filing path.
//
// Browser-only, but safe to import anywhere: with no localStorage present
// (server render, node test) every function is a no-op returning empty.

/** One remembered filing. Deliberately the smallest record that lets a resident
 *  recognise their own report in a list and open it again. */
export type RememberedReport = {
  /** The submission id — the capability for /track/<id>. */
  id: string;
  category: string;
  department: string;
  /** ISO timestamp, stamped by the device that filed it. */
  filedAt: string;
  /** The geocoded address, if the report had a location. Public street corner. */
  matched?: string;
};

const KEY = 'nf_reports_v1';

/** Newest first, capped. Long enough that a normal resident never loses one,
 *  short enough that a shared device isn't a filing history. */
const CAP = 20;

/**
 * The device's store, or null when there isn't one.
 *
 * Both halves of this need wrapping. Blocked cookies make the *property access*
 * throw SecurityError in some browsers; Safari private mode hands back a real
 * object whose setItem throws. So this only proves a store exists — every call
 * site still guards its own read and write.
 */
function store(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Anything on disk is untrusted input — it survived a browser upgrade, another
 *  tab's version of this code, or a curious person with devtools. Drop what
 *  doesn't fit rather than rendering `undefined` into someone's list. */
function clean(raw: unknown): RememberedReport[] {
  if (!Array.isArray(raw)) return [];
  const out: RememberedReport[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rec: RememberedReport = {
      id,
      category: typeof r.category === 'string' ? r.category : '',
      department: typeof r.department === 'string' ? r.department : '',
      filedAt: typeof r.filedAt === 'string' ? r.filedAt : '',
    };
    if (typeof r.matched === 'string' && r.matched.trim()) rec.matched = r.matched;
    out.push(rec);
    if (out.length >= CAP) break;
  }
  return out;
}

/** What this device filed, newest first. Empty when it can't know. */
export function rememberedReports(): RememberedReport[] {
  const s = store();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    if (!raw) return [];
    return clean(JSON.parse(raw));
  } catch {
    // Unparseable is the same as unknown. Deliberately not clearing the key on
    // a bad read — a transient failure shouldn't erase a working list.
    return [];
  }
}

/**
 * Record a filing. Returns true only if it actually landed, so a caller can
 * tell the resident the truth about whether this device will remember.
 *
 * Never throws. Callers are inside the submit path.
 */
export function rememberReport(report: RememberedReport): boolean {
  const s = store();
  if (!s) return false;
  const id = String(report.id ?? '').trim();
  if (!id) return false;
  try {
    // Re-filing the same id moves it to the top rather than duplicating it.
    const next = [{ ...report, id }, ...rememberedReports().filter((r) => r.id !== id)].slice(0, CAP);
    s.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    // Quota, private mode, a disabled store. The report itself is already filed
    // on the server; losing the local breadcrumb is the smaller failure.
    return false;
  }
}

/**
 * The eraser. A device-memory feature without one is a privacy problem we
 * authored ourselves — someone filing from a library computer needs this.
 *
 * Forgetting is local only: the reports themselves still exist, and still open
 * for anyone holding the URL.
 */
export function forgetReports(): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

/** Whether this device can remember at all — used to soften the empty state
 *  for someone browsing privately, who otherwise gets told they've filed
 *  nothing when they may have filed plenty. */
export function canRemember(): boolean {
  const s = store();
  if (!s) return false;
  try {
    const probe = `${KEY}__probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
