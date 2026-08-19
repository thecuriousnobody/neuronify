// The intake conversation, one turn at a time. The LLM extracts values + writes
// the next reply; the engine does the deterministic work: coerce values to field
// types, merge into the running draft, and decide what's still missing. Keeping
// completeness in code (not the model) is what makes the verify step trustworthy.

import type {
  FieldValue,
  FieldValuePrimitive,
  FormDefinition,
  FormField,
} from '../domain/types';
import type { LLM } from '../ports';
import { intakeSystemPrompt } from './prompt';
import { parseLooseJSON } from './json';

export type ChatRole = 'user' | 'assistant';
export interface ChatMessage {
  role: ChatRole;
  text: string;
}

export interface IntakeTurn {
  /** The assistant's next utterance — a clarifying question or a wrap-up. */
  reply: string;
  /** The merged draft after this turn. */
  draft: FieldValue[];
  /** Required field keys still empty (includes attachments). */
  missing: string[];
  /** True once every required NON-attachment field is filled. Attachments are
   *  gathered in the verify step, so they don't block the conversation. */
  readyForReview: boolean;
  /** Tap-able quick answers to `reply`, when the question has a natural small
   *  answer set. Empty for open-ended questions. */
  suggestions: string[];
}

/**
 * The conversation as plain text, one labelled line per turn.
 *
 * Used both to show the model what has been said and to preserve the exchange
 * into the record. One formatter, so what staff read afterwards is exactly what
 * the assistant was working from.
 */
export function formatTranscript(history: ChatMessage[]): string {
  return history
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => `${m.role === 'user' ? 'Resident' : 'Assistant'}: ${m.text.trim()}`)
    .join('\n');
}

/** The LLM's suggestions are shown as buttons — keep them short, few, and clean. */
function sanitizeSuggestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (!t || t.length > 40 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === 5) break;
  }
  return out;
}

function coerce(field: FormField, raw: unknown): FieldValuePrimitive | undefined {
  if (raw == null || raw === '') return undefined;
  switch (field.type) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).toLowerCase().trim();
      if (['yes', 'true', 'y', '1'].includes(s)) return true;
      if (['no', 'false', 'n', '0'].includes(s)) return false;
      return undefined;
    }
    case 'choice': {
      const s = String(raw);
      return field.choices?.includes(s) ? s : undefined;
    }
    default:
      return String(raw);
  }
}

export function mergeDraft(
  form: FormDefinition,
  prior: FieldValue[],
  extracted: Record<string, unknown>,
): FieldValue[] {
  const byKey = new Map(prior.map((v) => [v.fieldKey, v]));
  for (const field of form.fields) {
    if (!(field.key in extracted)) continue;
    const value = coerce(field, extracted[field.key]);
    if (value === undefined) continue; // ignore uncoercible / empty extractions
    // Keep whatever the slot already carried alongside its value. An uploaded
    // photo and a resolved geocode are not things the model can re-state, so
    // overwriting the whole entry would silently drop them.
    const previous = byKey.get(field.key);
    byKey.set(field.key, { ...previous, fieldKey: field.key, value });
  }
  return [...byKey.values()];
}

export function missingRequired(form: FormDefinition, draft: FieldValue[]): string[] {
  const have = new Set(
    draft.filter((v) => v.value !== '' && v.value != null).map((v) => v.fieldKey),
  );
  return form.fields.filter((f) => f.required && !have.has(f.key)).map((f) => f.key);
}

/**
 * Sentences that claim the report is wrapped up or being filed. Only consulted
 * while required fields are still missing — at that moment any such claim is
 * false by definition (observed live: "You're all set to review and submit your
 * report. One more thing — What's going on?" — the turn contradicted itself).
 */
const WRAPUP_CLAIM =
  /\b(all set|good to go|ready to (?:review|submit)|review and submit|that[’']s everything|we[’']re (?:all )?done|i[’'](?:m|ll) (?:be )?(?:send|submit|fil)\w*|(?:sending|filing|submitting) (?:this|it|your)|has been (?:sent|filed|submitted)|report is (?:filed|submitted|complete|done|on its way))\b/i;

/** Drop the sentences that falsely claim wrap-up; keep the rest of the reply. */
export function stripWrapUpClaims(reply: string): string {
  return reply
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => !WRAPUP_CLAIM.test(s))
    .join(' ')
    .trim();
}

/** The field's label, asked as a bare question — no "One more thing —" prefix,
 *  no raw label pasting mid-sentence. Labels are authored question-shaped
 *  ("What's going on?", "Roughly how big?"), so the label IS the question. */
function questionFor(field: FormField): string {
  return `${field.label.trim().replace(/[?.!\s]+$/, '')}?`;
}

/** Run one conversational turn. Pure except for the single LLM call. */
export async function runIntakeTurn(
  llm: LLM,
  form: FormDefinition,
  history: ChatMessage[],
  priorDraft: FieldValue[],
  userMessage: string,
): Promise<IntakeTurn> {
  const transcript = formatTranscript(history);
  const known = JSON.stringify(Object.fromEntries(priorDraft.map((v) => [v.fieldKey, v.value])));
  const user = `Known values so far: ${known}\n\nConversation so far:\n${transcript || '(none)'}\n\nResident just said: "${userMessage}"\n\nReturn the JSON.`;

  const raw = await llm.complete({ system: intakeSystemPrompt(form), user, maxTokens: 600 });
  const parsed = parseLooseJSON<{
    reply?: string;
    extracted?: Record<string, unknown>;
    suggestions?: unknown;
  }>(raw);

  let draft = mergeDraft(form, priorDraft, parsed.extracted ?? {});

  // On a fact-dense opener the model reliably extracts the SPECIFIC fields
  // (location, size, hazard) and leaves the general prose one empty, then asks
  // "what's going on?" for the very thing it was just told (observed live,
  // 2026-08-18, and reproduced 6/6 against the real model). Prompts are
  // advisory, so the guarantee lives here: if the opening message demonstrably
  // carried facts (something else was extracted from it) but the required
  // prose field is still empty, the opener itself — the resident's own words,
  // verbatim — is that field's value.
  const openerTurn = !priorDraft.some((v) => v.value !== '' && v.value != null);
  if (openerTurn) {
    const filled = (key: string) =>
      draft.some((v) => v.fieldKey === key && v.value !== '' && v.value != null);
    const prose = form.fields.find((f) => f.required && f.type === 'longtext');
    const minedOther = draft.some(
      (v) => v.fieldKey !== prose?.key && v.value !== '' && v.value != null,
    );
    if (prose && minedOther && !filled(prose.key)) {
      draft = mergeDraft(form, draft, { [prose.key]: userMessage.trim() });
    }
  }

  const missing = missingRequired(form, draft);
  const missingNonAttachment = missing.filter(
    (k) => form.fields.find((f) => f.key === k)?.type !== 'attachment',
  );

  // The model must not wrap up while fields are missing — but prompts are
  // advisory (observed live: "I'm sending this to our street repair team right
  // now." with three fields still empty — the resident waits for a review card
  // that never comes). The guard must FIRE, and the turn it produces must be
  // coherent: first suppress any false wrap-up claim, then — unless the reply
  // already ends with a question — ask for the next missing field. Ends-with,
  // not contains: a rhetorical "sound good?" mid-claim must not defeat it.
  let reply = String(parsed.reply ?? '').trim();
  const ready = missingNonAttachment.length === 0;
  if (!ready) {
    reply = stripWrapUpClaims(reply);
    if (!/\?\s*$/.test(reply)) {
      const next = form.fields.find((f) => missingNonAttachment.includes(f.key));
      if (next) {
        const q = questionFor(next);
        reply = reply ? `${reply} ${q}` : q;
      }
    }
  }

  return {
    reply,
    draft,
    missing,
    readyForReview: ready,
    suggestions: sanitizeSuggestions(parsed.suggestions),
  };
}
