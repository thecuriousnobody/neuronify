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
- Use the exact field keys above.

OUTPUT RULES — CRITICAL: Output ONLY raw JSON. No markdown, no code fences, no text before or after. First character {, last character }.

Schema:
{ "extracted": { "<fieldKey>": <value> } }`;
}

/** Single-shot fill: pull every stated field from the whole transcript at once. */
export async function extractFields(
  llm: LLM,
  form: FormDefinition,
  transcript: string,
): Promise<FieldValue[]> {
  const raw = await llm.complete({
    system: extractSystemPrompt(form),
    user: `Resident's report (transcribed):\n"""${transcript}"""\n\nReturn the JSON.`,
    maxTokens: 500,
  });
  const parsed = parseLooseJSON<{ extracted?: Record<string, unknown> }>(raw);
  return mergeDraft(form, [], parsed.extracted ?? {});
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
  const raw = await llm.complete({
    system: classifySystemPrompt(form.city, opts.departments),
    user: `Resident's report (transcribed):\n"""${transcript}"""\n\nReturn the JSON.`,
    maxTokens: 300,
  });
  const p = parseLooseJSON<Partial<Classification>>(raw);

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
