// The digestion pipeline: one voice drop → the agent fills the form and
// classifies it, in inspectable STAGES. This is the "shows its work" core of
// Blake's design — the resident isn't answering questions, they're watching a
// form get filled and can correct any stage. Completeness + constraint stay in
// code (mergeDraft / the allow-lists here), never the model, so a staffer can
// trust what the confirm gate shows.
//
// Stages, each usable alone:
//   extractFields — transcript → form values (single-shot, reuses the coercers)
//   classify      — transcript → { category, severity, department } (constrained)
//   digestDrop    — runs both and returns one inspectable result
// Composition (classification → WorkflowGraph) lives in ./compose.

import type { FieldValue, FormDefinition } from '../domain/types';
import type { LLM } from '../ports';
import { mergeDraft, missingRequired } from './conversation';
import { parseLooseJSON } from './json';

/**
 * One LLM call → parsed JSON, with a single retry on malformed output. Models
 * occasionally emit unparseable JSON; one re-ask almost always recovers, and it
 * keeps a transient model hiccup from surfacing as a 500 mid-demo.
 */
async function completeJson<T>(
  llm: LLM,
  args: { system: string; user: string; maxTokens?: number },
): Promise<T> {
  try {
    return parseLooseJSON<T>(await llm.complete(args));
  } catch {
    return parseLooseJSON<T>(await llm.complete(args));
  }
}

/** The city's real 4-level scale (mirrors lib/agents.ts; safety first). */
export type Severity = 'safety_critical' | 'high' | 'medium' | 'low';
export const SEVERITIES: Severity[] = ['safety_critical', 'high', 'medium', 'low'];

export interface Classification {
  /** Free-text category label, e.g. "Roads & Infrastructure". */
  category: string;
  severity: Severity;
  /** MUST be one of the allowed departments — the composer routes on this. */
  department: string;
  /** One line of reasoning — surfaced to staff so the routing is defensible. */
  rationale: string;
}

export interface DigestResult {
  transcript: string;
  /** Filled form values (fill stage). */
  values: FieldValue[];
  /** Required field keys still empty — the confirm gate flags these. */
  missing: string[];
  /** Category + severity + department (classify stage). */
  classification: Classification;
}

// ── fill ─────────────────────────────────────────────────────────────────────

function extractSystemPrompt(form: FormDefinition): string {
  const fields = form.fields
    .map((f) => {
      const head = `- "${f.key}" (${f.type}${f.required ? ', required' : ', optional'}): ${f.label}`;
      const extra: string[] = [];
      if (f.choices?.length) extra.push(`    choices: ${f.choices.join(' | ')}`);
      if (f.type === 'attachment') extra.push(`    (a file/photo — gathered at review, not from the transcript)`);
      return [head, ...extra].join('\n');
    })
    .join('\n');

  return `You extract structured fields from a resident's spoken report to ${form.city}, filling a "${form.title}" form. The fields:

${fields}

Rules:
- Extract a value ONLY when the transcript actually states it. NEVER invent, assume, or guess.
- Leave a field out entirely if the resident didn't give it. Do not fill attachment fields.
- For a field of type "location", extract ONLY an actual PLACE — a street, intersection,
  address, or named landmark. If the resident described the problem but never said WHERE it
  is, leave the location field out entirely. Do NOT put the thing being reported (e.g. "a
  broken sidewalk") into the location field, and do NOT extract vague non-places like
  "my street", "a block", or "near my house" — those count as not given.
- CORRECTIONS WIN: residents often correct themselves ("no, actually it's at...").
  When the transcript states a field more than once, the LATEST statement is the
  truth. Lines of the form "Q: <question> A: <answer>" are explicit clarification
  answers and always take priority over earlier prose.
- Use the exact field keys above.

OUTPUT RULES — CRITICAL: Output ONLY raw JSON. No markdown, no code fences, no text before or after. First character {, last character }.

Schema:
{ "extracted": { "<fieldKey>": <value> } }`;
}

/**
 * A location value must look like an actual place: a proper noun ("Knoxville
 * Avenue") or a number ("512 Main St"). Vague references ("a block", "my
 * street") fail this and are dropped — the prompt asks the model not to extract
 * them, but code is the enforcement (prompts are suggestions).
 */
function looksLikePlace(value: unknown): boolean {
  const s = String(value ?? '').trim();
  if (!s) return false;
  return /\d/.test(s) || /(?:^|[\s,&])[A-Z][a-z]/.test(s.slice(0, 1).toLowerCase() + s.slice(1));
}

/** Single-shot fill: pull every stated field from the whole transcript at once. */
export async function extractFields(
  llm: LLM,
  form: FormDefinition,
  transcript: string,
): Promise<FieldValue[]> {
  const parsed = await completeJson<{ extracted?: Record<string, unknown> }>(llm, {
    system: extractSystemPrompt(form),
    user: `Resident's report (transcribed):\n"""${transcript}"""\n\nReturn the JSON.`,
    maxTokens: 500,
  });
  const merged = mergeDraft(form, [], parsed.extracted ?? {});
  // Deterministic guard: vague non-places don't count as a location.
  const locationKeys = new Set(form.fields.filter((f) => f.type === 'location').map((f) => f.key));
  return merged.filter((v) => !locationKeys.has(v.fieldKey) || looksLikePlace(v.value));
}

// ── classify ─────────────────────────────────────────────────────────────────

function classifySystemPrompt(city: string, departments: string[]): string {
  return `You triage a resident's report to ${city}. Assign a category, a severity, and the ONE city department that owns the fix.

Departments (choose exactly one, use the exact key): ${departments.join(', ')}
Severity (choose one): ${SEVERITIES.join(' | ')}
  - safety_critical: imminent danger to people (e.g. live wire, gas, deep hazard in a travel lane)
  - high: significant risk or fast-worsening damage
  - medium: real problem, not urgent
  - low: minor / cosmetic

OUTPUT RULES — CRITICAL: Output ONLY raw JSON. No markdown, no code fences, no text before or after. First character {, last character }.

Schema:
{ "category": "short label", "severity": "<one of the above>", "department": "<one department key>", "rationale": "one sentence" }`;
}

/**
 * Classify a report. The LLM proposes; this function CONSTRAINS: severity is
 * clamped to the 4-level scale and department to the allow-list (fail-safe: an
 * unrecognized department defaults to the first listed, never an invented one).
 */
export async function classify(
  llm: LLM,
  form: FormDefinition,
  transcript: string,
  opts: { departments: string[] },
): Promise<Classification> {
  if (opts.departments.length === 0) throw new Error('classify requires at least one department');
  const p = await completeJson<Partial<Classification>>(llm, {
    system: classifySystemPrompt(form.city, opts.departments),
    user: `Resident's report (transcribed):\n"""${transcript}"""\n\nReturn the JSON.`,
    maxTokens: 300,
  });

  const severity: Severity = SEVERITIES.includes(p.severity as Severity)
    ? (p.severity as Severity)
    : 'medium';
  const department = opts.departments.includes(p.department ?? '')
    ? (p.department as string)
    : opts.departments[0];

  return {
    category: String(p.category ?? 'General').trim() || 'General',
    severity,
    department,
    rationale: String(p.rationale ?? '').trim(),
  };
}

// ── digest (both stages) ─────────────────────────────────────────────────────

/** Run the full digestion: fill, then classify. Nothing is launched here. */
export async function digestDrop(
  llm: LLM,
  form: FormDefinition,
  transcript: string,
  opts: { departments: string[] },
): Promise<DigestResult> {
  const values = await extractFields(llm, form, transcript);
  const missing = missingRequired(form, values);
  const classification = await classify(llm, form, transcript, opts);
  return { transcript, values, missing, classification };
}
