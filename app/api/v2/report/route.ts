// Resident-side: park a transcribed voice drop for staff review. This is BEFORE
// the confirm gate — it creates a pending intake, not a submission. A staffer
// picks it up on /desk/intake, digests, and launches. Beta-gated + rate-limited;
// body-capped (the transcript is free-form text).

import { createPending } from '@/lib/pending';
import { resolveCity } from '@/lib/cities';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TRANSCRIPT = 8000;
const DEFAULT_FORM = 'pothole_report';

export async function POST(req: Request) {
  // Anonymous mic-first drop (see /api/v2/transcribe); rate-limited + capped.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = rateLimit(ip);
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const transcript = String(body?.transcript ?? '').trim();
  if (!transcript) return Response.json({ error: 'Tell the city what’s going on first.' }, { status: 400 });
  if (transcript.length > MAX_TRANSCRIPT)
    return Response.json({ error: `Keep it under ${MAX_TRANSCRIPT} characters.` }, { status: 400 });

  const formKey = String(body?.formKey ?? DEFAULT_FORM).trim() || DEFAULT_FORM;
  const city = resolveCity(body?.city ?? null);
  const source = body?.source === 'text' ? 'text' : 'voice';

  const { id, createdAt } = await createPending({ formKey, city: city.db, transcript, source });
  return Response.json({ id, createdAt });
}
