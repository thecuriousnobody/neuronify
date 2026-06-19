// One conversational intake turn: the resident speaks/types, the assistant asks
// the next question and we return the merged draft + what's still missing.
import { engineEnv } from '@/lib/engine';
import { runIntakeTurn, type ChatMessage, type FieldValue } from '@/engine';
import { rateLimit } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/engine/http';
import { currentUser } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MSG = 2000;
const MAX_HISTORY = 24;

export async function POST(req: Request) {
  // Beta gate: must be signed in with Google.
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Please sign in to continue.' }, { status: 401 });

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

  const formKey = String(body?.formKey ?? '').trim();
  const message = String(body?.message ?? '').trim();
  if (!formKey) return Response.json({ error: 'Missing formKey.' }, { status: 400 });
  if (!message) return Response.json({ error: 'Tell me what’s going on first.' }, { status: 400 });
  if (message.length > MAX_MSG) return Response.json({ error: `Keep it under ${MAX_MSG} characters.` }, { status: 400 });

  const history: ChatMessage[] = (Array.isArray(body?.history) ? body.history : [])
    .slice(-MAX_HISTORY)
    .map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: String(m?.text ?? '') }));
  const draft: FieldValue[] = (Array.isArray(body?.draft) ? body.draft : [])
    .filter((v: any) => v && typeof v.fieldKey === 'string')
    .map((v: any) => ({ fieldKey: v.fieldKey, value: v.value ?? null }));

  const env = engineEnv();
  const form = await env.repo.getFormDefinition(formKey);
  if (!form) return Response.json({ error: 'Unknown form.' }, { status: 404 });

  try {
    const turn = await runIntakeTurn(env.llm, form, history, draft, message);
    return Response.json(turn);
  } catch (err) {
    return errorResponse(err);
  }
}
