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
  departmentFor,
  CATEGORIES,
  TEMPLATE_FORM_CITY,
  detectEmergency,
  emergencyContactsFor,
  type ChatMessage,
  type FieldValue,
  type CategoryKey,
  type EmergencyKind,
} from '@/engine';
import { rateLimit } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/engine/http';
import { geocodeCandidates } from '@/lib/geocode';
import { labelCandidates } from '@/lib/landmarks';
import { logIntake, cleanSessionId, turnCount } from '@/lib/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MSG = 2000;
const MAX_HISTORY = 24;
/** How much of an over-long message the emergency scan still reads. Bigger than
 *  MAX_MSG on purpose: a message can be rejected for length and still be someone
 *  describing a gas leak. */
const MAX_SCAN = 8000;
const KNOWN_CATEGORIES = new Set<string>(CATEGORIES.map((c) => c.key));

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = String(body?.message ?? '').trim();
  // The client echoes the locked category back once triage has set it.
  const rawCat = String(body?.category ?? '').trim().toLowerCase();
  const locked: CategoryKey | null = KNOWN_CATEGORIES.has(rawCat) ? (rawCat as CategoryKey) : null;

  // ── The hard stop. FIRST — ahead of the rate limit and the length cap. ──
  // Not just ahead of the model: ahead of every way this endpoint can say no.
  // Tapping a chip and then typing "I smell gas" lands inside the chat bucket's
  // minimum gap, and a long dictated description of a gas leak exceeds the
  // character cap — in both cases the resident would have received a scolding
  // and no warning at all. A regex pass costs nothing, so nothing gets to come
  // before it. The decision is also not one an assistant could weigh against
  // being helpful, because the model is never consulted.
  //
  // The client echoes back which warnings it has already shown, so an
  // acknowledged one doesn't wall them out of finishing the report afterwards.
  const acknowledged: EmergencyKind[] = (Array.isArray(body?.acknowledgedEmergencies)
    ? body.acknowledgedEmergencies
    : []
  ).filter((k: unknown): k is EmergencyKind =>
    k === 'life_safety' || k === 'gas' || k === 'power' || k === 'water',
  );
  const emergency = detectEmergency(
    message.slice(0, MAX_SCAN),
    emergencyContactsFor(TEMPLATE_FORM_CITY),
    acknowledged,
  );
  if (emergency) {
    return Response.json({
      phase: 'emergency',
      reply: emergency.message,
      emergency: { kind: emergency.kind, trigger: emergency.trigger },
      category: locked,
    });
  }

  // Anonymous by design — no sign-in gate. Rate-limited per IP like the other
  // public endpoints.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const limit = rateLimit(ip, 'chat');
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  if (!message) return Response.json({ error: 'Tell me what’s going on first.' }, { status: 400 });
  if (message.length > MAX_MSG) return Response.json({ error: `Keep it under ${MAX_MSG} characters.` }, { status: 400 });

  const history: ChatMessage[] = (Array.isArray(body?.history) ? body.history : [])
    .slice(-MAX_HISTORY)
    .map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: String(m?.text ?? '') }));
  const draft: FieldValue[] = (Array.isArray(body?.draft) ? body.draft : [])
    .filter((v: any) => v && typeof v.fieldKey === 'string')
    .map((v: any) => ({ fieldKey: v.fieldKey, value: v.value ?? null }));

  const env = engineEnv();

  // Which conversation this turn belongs to. Random, tab-scoped, not a person —
  // see lib/intake-session.ts. Absent (private mode, old client) simply means
  // this turn goes unrecorded; nothing downstream depends on it.
  const sessionId = cleanSessionId(body?.sessionId);
  const turnNo = turnCount(history) + 1;

  /**
   * One collecting turn over a known category, plus the geocode that may fall
   * out of it. Shared by both phases: the turn where the category LOCKS has to
   * collect too, or the message that revealed the category is never mined for
   * the facts it contained.
   */
  async function collect(category: CategoryKey) {
    const form = formForCategory(category);
    const turn = await runIntakeTurn(env.llm, form, history, draft, message);

    // Resolve the location to a real address + GPS — but only when it just got
    // filled or changed this turn (keeps geocoder calls off every message).
    const locField = form.fields.find((f) => f.type === 'location');
    const newLoc = locField ? turn.draft.find((v) => v.fieldKey === locField.key)?.value : null;
    const priorLoc = locField ? draft.find((v) => v.fieldKey === locField.key)?.value : null;
    let geo:
      | { fieldKey: string; matched: string; lat: number; lon: number; for: string; approximate?: boolean }
      | null = null;
    let geoCandidates: {
      matched: string;
      lat: number;
      lon: number;
      label?: string;
      approximate?: boolean;
    }[] = [];
    if (locField && newLoc && newLoc !== priorLoc) {
      // Top candidate auto-pins (zero friction); the rest ride along so the
      // resident can tap "not this spot?" instead of typing corrections.
      geoCandidates = await geocodeCandidates(String(newLoc), TEMPLATE_FORM_CITY);
      // Ambiguity gets resident-friendly names ("near Northwoods Mall"), never
      // the compass-prefixed street forms nobody at the corner can resolve.
      if (geoCandidates.length > 1)
        geoCandidates = await labelCandidates(geoCandidates, TEMPLATE_FORM_CITY);
      // `for` is the text this pin was resolved FROM. The resident can still
      // edit that text on the review screen, and a pin that no longer matches
      // what the field says must not be shown or filed — see
      // lib/location-text.ts.
      if (geoCandidates[0])
        geo = { fieldKey: locField.key, ...geoCandidates[0], for: String(newLoc) };
    }

    const department = departmentFor(TEMPLATE_FORM_CITY, category);

    // The drop-off curve. `missing` is the useful part: the last row of an
    // abandoned conversation names the exact questions the resident was still
    // being asked when they gave up. Keys only — never their answers.
    await logIntake({
      sessionId,
      event: 'collecting',
      city: TEMPLATE_FORM_CITY,
      category,
      department,
      turn: turnNo,
      ready: turn.readyForReview,
      missing: turn.missing,
    });

    return Response.json({
      phase: 'collecting',
      reply: turn.reply,
      category,
      department,
      form: { key: form.key, title: form.title, fields: form.fields },
      draft: turn.draft,
      missing: turn.missing,
      readyForReview: turn.readyForReview,
      suggestions: turn.suggestions,
      geo,
      geoCandidates,
    });
  }

  try {
    // ── Phase 1 — no category yet: discern it. ──
    if (!locked) {
      const t = await discernCategory(env.llm, TEMPLATE_FORM_CITY, history, message);
      if (!t.category) {
        // Still unclear — ask another question, stay in triage. Worth recording
        // on its own: a pile of these means the agent can't tell what people
        // are reporting, which is a different problem from losing them later.
        await logIntake({
          sessionId,
          event: 'triage',
          city: TEMPLATE_FORM_CITY,
          turn: turnNo,
        });
        return Response.json({ phase: 'triage', reply: t.reply, category: null });
      }
      // Category just locked — now COLLECT from the very message that revealed
      // it. Residents lead with everything they know ("pothole at 4th and Main,
      // in the traffic lane, dinner-plate size"); this used to return the triage
      // reply and an empty draft, so all of it was thrown away and every field
      // was asked again from scratch (Blake, 2026-08-07 — his worst finding).
      // We drop the triage reply: the collecting turn can see which slots the
      // opener already filled, so it asks for what's actually left, and the
      // client renders the category itself as a "detected" card.
      return await collect(t.category);
    }

    // ── Phase 2 — category known: collect its fields. ──
    return await collect(locked);
  } catch (err) {
    return errorResponse(err);
  }
}
