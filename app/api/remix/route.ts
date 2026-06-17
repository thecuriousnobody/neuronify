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
  if (!text) return Response.json({ error: 'text required' }, { status: 400 });

  const raw = await callLLM({
    system:
      'You riff on brainstorming ideas. Given an idea, produce ONE variation that explores a different angle, approach, or twist — same topic space but meaningfully different. Return ONLY the new idea text, nothing else. No quotes, no explanation. Match the approximate length and directness of the original.',
    user: text,
    model: MODELS.augment,
    temperature: 1.1,
    maxTokens: 60,
  });

  const variation = raw.trim().replace(/^["'`]+|["'`]+$/g, '');
  return Response.json({ variation });
}
