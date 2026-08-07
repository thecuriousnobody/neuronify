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

  const draft = mergeDraft(form, priorDraft, parsed.extracted ?? {});
  const missing = missingRequired(form, draft);
  const missingNonAttachment = missing.filter(
    (k) => form.fields.find((f) => f.key === k)?.type !== 'attachment',
  );

  // The model must not wrap up while fields are missing — but prompts are
  // advisory. If it produced a question-free reply mid-collection (observed
  // live: "I'm sending this to our street repair team right now." with three
  // fields still empty — the resident waits for a review card that never
  // comes), deterministically append a question for the next missing field.
  let reply = String(parsed.reply ?? '').trim();
  const ready = missingNonAttachment.length === 0;
  if (!ready && !reply.includes('?')) {
    const next = form.fields.find((f) => missingNonAttachment.includes(f.key));
    if (next) {
      const q = `One more thing — ${next.label.replace(/\?+\s*$/, '')}?`;
      reply = reply ? `${reply} ${q}` : q;
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
