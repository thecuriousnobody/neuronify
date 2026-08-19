// Candidate-map proxy. The resident-side UI shows ambiguous geocode candidates
// as pins on a small map (Rajeev's Fix 4 call, 2026-08-19: pins beat street
// names a person standing at the corner can't resolve). The Google key must
// not reach the client, so the image is fetched here and streamed back.
//
// Strictly validated (parsePins) and rate-limited: this is a public endpoint
// in front of a paid API. Fail-soft on the client — a broken image simply
// hides, and the labeled buttons still work.
import { parsePins, staticMapUrl } from '@/lib/staticmap';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return new Response('map unavailable', { status: 404 });

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = rateLimit(ip, 'staticmap');
  if (!limit.ok) return new Response(limit.reason, { status: 429 });

  const pins = parsePins(new URL(req.url).searchParams.get('pins'));
  if (!pins) return new Response('bad pins', { status: 400 });

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(staticMapUrl(pins, key), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return new Response('map unavailable', { status: 502 });
    const image = await res.arrayBuffer();
    return new Response(image, {
      headers: {
        'content-type': res.headers.get('content-type') ?? 'image/png',
        // Coordinates never change meaning — let the browser keep it.
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('map unavailable', { status: 502 });
  }
}
