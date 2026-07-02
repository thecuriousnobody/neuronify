// Speech-to-text for the voice-first drop, backed by Deepgram Nova-3.
//
// Ported from desilo-distillery (Vercel Pages `api/transcribe`) into the Next.js
// App Router idiom: raw audio arrives as the request body (webm/opus from the
// browser MediaRecorder is the typical input) and we return { transcript }.
// Deepgram gives accurate, punctuated, consistent transcripts — the raw material
// the digestion pipeline (fill → classify → compose) then works on.
//
// Guardrails (paid upstream + public surface): Google beta gate, per-IP rate
// limit, and an explicit body-size cap so a runaway upload can't burn credits.

import { rateLimit } from '@/lib/ratelimit';
import { currentUser } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ~25 MB — comfortably covers a minute-plus voice drop, well short of abuse.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  // Beta gate: must be signed in (matches /api/v2/intake).
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Please sign in to continue.' }, { status: 401 });

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = rateLimit(ip);
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.error('[transcribe] DEEPGRAM_API_KEY not configured');
    return Response.json({ error: 'Transcription is not configured.' }, { status: 500 });
  }

  const contentType = req.headers.get('content-type') || 'audio/webm';
  const audio = Buffer.from(await req.arrayBuffer());
  if (audio.length === 0) return Response.json({ error: 'Empty audio body.' }, { status: 400 });
  if (audio.length > MAX_AUDIO_BYTES)
    return Response.json({ error: 'Recording is too large.' }, { status: 413 });

  // Deepgram Nova-3, conversational defaults: smart_format + punctuate for clean,
  // capitalized, punctuated output; en-US (can be made dynamic per city later).
  const dgUrl = new URL('https://api.deepgram.com/v1/listen');
  dgUrl.searchParams.set('model', 'nova-3');
  dgUrl.searchParams.set('smart_format', 'true');
  dgUrl.searchParams.set('punctuate', 'true');
  dgUrl.searchParams.set('language', 'en-US');

  try {
    const dgRes = await fetch(dgUrl.toString(), {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': contentType },
      body: audio,
    });

    if (!dgRes.ok) {
      const detail = await dgRes.text().catch(() => '');
      console.error('[transcribe] Deepgram error', dgRes.status, detail);
      return Response.json({ error: 'Transcription upstream failed.' }, { status: 502 });
    }

    const data = await dgRes.json();
    const transcript: string =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    return Response.json({ transcript });
  } catch (err) {
    console.error('[transcribe] handler error:', err);
    return Response.json({ error: 'Transcription failed.' }, { status: 500 });
  }
}
