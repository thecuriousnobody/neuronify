// Defensive JSON parse for model output — engine-local (the engine can't import
// lib/ai). Strips stray code fences, then falls back to slicing the outermost
// braces. Mirrors the standing lesson from the v1 baseline.

export function parseLooseJSON<T = unknown>(raw: string): T {
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    const s = clean.indexOf('{');
    const e = clean.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) return JSON.parse(clean.slice(s, e + 1)) as T;
    throw new Error('Could not parse JSON from model output');
  }
}
