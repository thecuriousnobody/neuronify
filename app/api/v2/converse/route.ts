// Anonymous, category-first intake — one conversational turn.
//
// Unlike /api/v2/intake (sign-in gated, fixed formKey), this is the PUBLIC voice
// path: the resident just talks. Phase 1 (no category yet) runs a triage turn to
// discern the category; once it LOCKS, Phase 2 loads that category's form and
// collects its fields — the same runIntakeTurn loop, over the category's schema.
// Stateless: the client echoes back { history, draft, category } each turn.
import { engineEnv } from '@/lib/engine';
import {
  discernCategory,
  runIntakeTurn,
  formForCategory,
  CATEGORIES,
  TEMPLATE_FORM_CITY,
  type ChatMessage,
  type FieldValue,
  type CategoryKey,
} from '@/engine';
import { rateLimit } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/engine/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MSG = 2000;
const MAX_HISTORY = 24;
const KNOWN_CATEGORIES = new Set<string>(CATEGORIES.map((c) => c.key));

export async function POST(req: Request) {
  // Anonymous by design — no sign-in gate. Rate-limited per IP like the other
  // public endpoints.
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

  const message = String(body?.message ?? '').trim();
  if (!message) return Response.json({ error: 'Tell me what’s going on first.' }, { status: 400 });
  if (message.length > MAX_MSG) return Response.json({ error: `Keep it under ${MAX_MSG} characters.` }, { status: 400 });

  const history: ChatMessage[] = (Array.isArray(body?.history) ? body.history : [])
    .slice(-MAX_HISTORY)
    .map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: String(m?.text ?? '') }));
  const draft: FieldValue[] = (Array.isArray(body?.draft) ? body.draft : [])
    .filter((v: any) => v && typeof v.fieldKey === 'string')
    .map((v: any) => ({ fieldKey: v.fieldKey, value: v.value ?? null }));

  // The client echoes the locked category back once triage has set it.
  const rawCat = String(body?.category ?? '').trim().toLowerCase();
  const locked: CategoryKey | null = KNOWN_CATEGORIES.has(rawCat) ? (rawCat as CategoryKey) : null;

  const env = engineEnv();
  try {
    // ── Phase 1 — no category yet: discern it. ──
    if (!locked) {
      const t = await discernCategory(env.llm, TEMPLATE_FORM_CITY, history, message);
      if (!t.category) {
        // Still unclear — ask another question, stay in triage.
        return Response.json({ phase: 'triage', reply: t.reply, category: null });
      }
      // Category just locked. The triage reply already asks for the first detail;
      // the accumulated history carries the resident's initial description into
      // the collection turns that follow, so nothing they've said is lost.
      const form = formForCategory(t.category);
      return Response.json({
        phase: 'collecting',
        reply: t.reply,
        category: t.category,
        form: { key: form.key, title: form.title, fields: form.fields },
        draft,
        missing: form.fields.filter((f) => f.required).map((f) => f.key),
        readyForReview: false,
      });
    }

    // ── Phase 2 — category known: collect its fields. ──
    const form = formForCategory(locked);
    const turn = await runIntakeTurn(env.llm, form, history, draft, message);
    return Response.json({
      phase: 'collecting',
      reply: turn.reply,
      category: locked,
      form: { key: form.key, title: form.title, fields: form.fields },
      draft: turn.draft,
      missing: turn.missing,
      readyForReview: turn.readyForReview,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
