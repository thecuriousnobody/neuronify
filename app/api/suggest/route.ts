import { callLLM, MODELS } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = String(body?.text ?? '').trim();
  if (!text || text.length < 3) {
    return Response.json({ suggestion: '' });
  }
  if (text.length > 500) {
    return Response.json({ error: 'text too long' }, { status: 400 });
  }

  try {
    const raw = await callLLM({
      system:
        'You complete partial brainstorming ideas. Given the beginning of an idea, return ONLY the natural continuation — 3 to 8 words. No punctuation at the start, no quotes, no explanation. Output only the continuation words, nothing else.',
      user: text,
      model: MODELS.augment,
      temperature: 0.8,
      maxTokens: 40,
    });

    let suggestion = raw.trim().replace(/^["',\s]+|["',\s]+$/g, '');

    // Strip prefix echo if the model repeated the input
    const textLower = text.toLowerCase();
    const suggLower = suggestion.toLowerCase();
    if (suggLower.startsWith(textLower)) {
      suggestion = suggestion.slice(text.length).trimStart();
    }

    return Response.json({ suggestion });
  } catch (err: any) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
