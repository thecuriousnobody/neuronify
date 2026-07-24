// Phase one of a category-first intake: BEFORE any form exists, figure out which
// kind of report this is. The resident just talks; the assistant either asks one
// clarifying question (category still unclear) or LOCKS the category and hands
// off to field collection (runIntakeTurn over that category's form).
//
// The model PROPOSES; the engine CONSTRAINS: a category is accepted only when it
// matches a known taxonomy key — anything else means "keep listening", so noise
// never locks the conversation onto the wrong thing. (see ./taxonomy)

import type { LLM } from '../ports';
import type { ChatMessage } from './conversation';
import { parseLooseJSON } from './json';
import { CATEGORIES, type CategoryKey } from './taxonomy';

export interface TriageTurn {
  /** The assistant's next utterance — a clarifying question, or a short hand-off
   *  once the category is known. */
  reply: string;
  /** The locked category once confidently identified; null while still unclear. */
  category: CategoryKey | null;
  /** One line — why this category (surfaced to staff; helps debug a misroute). */
  rationale: string;
}

const KNOWN = new Set<string>(CATEGORIES.map((c) => c.key));

function triageSystemPrompt(city: string): string {
  const cats = CATEGORIES.map((c) => `- ${c.key} — ${c.label}`).join('\n');
  return `You are the first point of contact for residents reporting an issue to ${city}. Right now your ONLY job is to work out WHICH kind of issue this is, then hand off. Be warm, brief, and plain — one question at a time.

The kinds of issue (categories):
${cats}

Some boundaries to get right:
- A broken or leaking water main, no water, low pressure, or a sewer backup is water_sewer — even when water is pooling or flooding the street. Use flooding_drainage ONLY for storm/rain water, a clogged catch basin, or standing water with no water main involved.
- A fallen or hanging tree, limb, or branch is tree_issue — even when it's blocking a sidewalk, a road, or power lines. Use sidewalk_damage ONLY for the pavement itself (cracks, heaves, missing sections, trip hazards).
- Rats, mice, or insects are rodent_pest. A dead animal that needs pickup is dead_animal.

Decide:
- If the description clearly matches ONE category, LOCK it: set "category" to that key, and write a short, friendly "reply" that confirms what you understood and asks for the first specific detail (usually where it is). Never ask the resident to pick a category — you infer it from what they say.
- If it is still too vague or could be several categories, set "category" to "unclear" and ask ONE simple clarifying question in "reply". Do not guess just to move on.

OUTPUT RULES — CRITICAL: Output ONLY raw JSON. No markdown, no code fences, no text before or after. First character {, last character }.

Schema:
{ "reply": "your next message to the resident", "category": "<one category key, or unclear>", "rationale": "one sentence, for staff" }`;
}

/**
 * Run one triage turn. Pure except for the single LLM call. Returns a locked
 * `category` once the report is unambiguous, or `null` (with a clarifying
 * `reply`) while it still needs to listen.
 */
export async function discernCategory(
  llm: LLM,
  city: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<TriageTurn> {
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'Resident' : 'Assistant'}: ${m.text}`)
    .join('\n');
  const user = `Conversation so far:\n${transcript || '(none)'}\n\nResident just said: "${userMessage}"\n\nReturn the JSON.`;

  const raw = await llm.complete({ system: triageSystemPrompt(city), user, maxTokens: 400 });
  const p = parseLooseJSON<{ reply?: string; category?: string; rationale?: string }>(raw);

  const proposed = String(p.category ?? '').trim().toLowerCase();
  const category = KNOWN.has(proposed) ? (proposed as CategoryKey) : null;

  return {
    reply: String(p.reply ?? '').trim(),
    category,
    rationale: String(p.rationale ?? '').trim(),
  };
}
