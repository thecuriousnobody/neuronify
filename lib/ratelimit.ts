// Best-effort, in-memory per-IP rate limit. Serverless instances are
// ephemeral so this is a soft guard against accidental rapid double-submits,
// not a security boundary. Better than nothing on a public endpoint.

const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const MIN_GAP_MS = 1_500;

export function rateLimit(ip: string): { ok: boolean; reason?: string } {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);

  if (arr.length && now - arr[arr.length - 1] < MIN_GAP_MS) {
    return { ok: false, reason: 'Too fast — give it a second.' };
  }
  if (arr.length >= MAX_PER_WINDOW) {
    return { ok: false, reason: 'Too many submissions — try again shortly.' };
  }

  arr.push(now);
  hits.set(ip, arr);
  return { ok: true };
}
