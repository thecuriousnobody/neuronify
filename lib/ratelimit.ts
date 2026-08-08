// Best-effort, in-memory per-IP rate limit. Serverless instances are
// ephemeral so this is a soft guard against accidental rapid double-submits,
// not a security boundary. Better than nothing on a public endpoint.
//
// Buckets exist because one shared counter punished normal behaviour: dictating
// a message hits /transcribe, and sending it a moment later hits /converse, so
// the second call landed inside the first one's 1.5s gap and the resident got
// "Too fast — give it a second." for doing nothing wrong (Blake 1.4). Endpoints
// that cost a model call or a real database write deserve a tighter leash than
// ordinary conversation; they no longer share one.

export type RateLimitBucket =
  | 'chat'
  | 'voice'
  | 'geocode'
  | 'upload'
  | 'submit'
  | 'desk'
  | 'default';

interface Policy {
  windowMs: number;
  maxPerWindow: number;
  /** Minimum spacing between two calls in this bucket. */
  minGapMs: number;
}

const POLICIES: Record<RateLimitBucket, Policy> = {
  // Conversation. Chips make fast consecutive answers normal, so the gap only
  // needs to stop a stuck key or a retry storm.
  chat: { windowMs: 60_000, maxPerWindow: 40, minGapMs: 400 },
  // Speech-to-text. Independent of chat: dictating then sending is one motion.
  voice: { windowMs: 60_000, maxPerWindow: 30, minGapMs: 500 },
  // Re-pinning an address the resident edited on the review screen. Its own
  // bucket for the same reason voice has one: correcting the address and then
  // sending a chat message is one motion, and a shared counter would scold them
  // for it. Costs a geocoder call, not a model call — a loose leash is fine.
  geocode: { windowMs: 60_000, maxPerWindow: 30, minGapMs: 400 },
  // A resident may legitimately attach several photos in a row.
  upload: { windowMs: 60_000, maxPerWindow: 20, minGapMs: 500 },
  // Filing writes a real, permanent record. Keep this strict.
  submit: { windowMs: 60_000, maxPerWindow: 20, minGapMs: 1_500 },
  // Staff sign-in — slow on purpose; this one is guessing-resistance.
  desk: { windowMs: 60_000, maxPerWindow: 10, minGapMs: 1_000 },
  default: { windowMs: 60_000, maxPerWindow: 20, minGapMs: 1_500 },
};

const hits = new Map<string, number[]>();

export function rateLimit(
  ip: string,
  bucket: RateLimitBucket = 'default',
  now: number = Date.now(),
): { ok: boolean; reason?: string } {
  const policy = POLICIES[bucket] ?? POLICIES.default;
  const key = `${bucket}:${ip}`;
  const arr = (hits.get(key) ?? []).filter((t) => now - t < policy.windowMs);

  if (arr.length && now - arr[arr.length - 1] < policy.minGapMs) {
    return { ok: false, reason: 'Too fast — give it a second.' };
  }
  if (arr.length >= policy.maxPerWindow) {
    return { ok: false, reason: 'Too many submissions — try again shortly.' };
  }

  arr.push(now);
  hits.set(key, arr);
  return { ok: true };
}

/** Test seam — the counter is module state, so suites must be able to clear it. */
export function resetRateLimits(): void {
  hits.clear();
}
