// Re-pin an address the resident edited after the conversation ended.
//
// /api/v2/converse geocodes as a side effect of a conversational turn, which
// covers everything said in chat. But the review screen lets the resident edit
// the address directly, and that edit reaches no conversational turn at all —
// so without this route their correction changes the words on the record while
// the map pin stays where the ORIGINAL phrasing put it. Same geocoder, same
// city anchor, same candidate list; just reachable from the review screen.
//
// `for` echoes back the exact text these candidates were resolved from, so the
// caller can tell whether they still apply to what's in the field (see
// lib/location-text.ts). Anonymous like the rest of the resident-facing path.
import { geocodeCandidates } from '@/lib/geocode';
import { TEMPLATE_FORM_CITY } from '@/engine';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LOCATION = 300;

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = rateLimit(ip, 'geocode');
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  const location = String(body?.location ?? '').trim();
  if (!location) return Response.json({ error: 'Nothing to look up.' }, { status: 400 });
  if (location.length > MAX_LOCATION)
    return Response.json({ error: `Keep the address under ${MAX_LOCATION} characters.` }, { status: 400 });

  // Fail-soft, like every other use of the geocoder: no match is not an error.
  // The report files on the resident's own words; the pin is the bonus.
  const candidates = await geocodeCandidates(location, TEMPLATE_FORM_CITY);
  return Response.json({ for: location, candidates });
}
