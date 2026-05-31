import { callLLM, parseLooseJSON, MODELS } from './ai';
import { type TriageResult } from './agents';
import { getPrompt } from './prompts';

// Run Agent A over one resident submission. Throws on parse/API failure so
// the caller can mark the row status='error' and still surface it on the wall.
export async function triage(rawText: string): Promise<TriageResult> {
  const raw = await callLLM({
    system: await getPrompt('agent_a'),
    user: rawText,
    model: MODELS.triage,
    temperature: 0.2,
    // Thinking is off, so the JSON is the only output — keep this tight to
    // stay well under Groq's free-tier tokens-per-minute ceiling.
    maxTokens: 512,
  });

  const data = parseLooseJSON<Partial<TriageResult>>(raw);

  // Coerce/guard the fields we write to typed DB columns.
  return {
    summary: String(data.summary ?? '').slice(0, 500),
    category: String(data.category ?? 'other'),
    severity: String(data.severity ?? 'low'),
    intervention: String(data.intervention ?? ''),
    cost_low_usd: Number.isFinite(Number(data.cost_low_usd)) ? Math.round(Number(data.cost_low_usd)) : 0,
    cost_high_usd: Number.isFinite(Number(data.cost_high_usd)) ? Math.round(Number(data.cost_high_usd)) : 0,
    cost_basis: String(data.cost_basis ?? ''),
    actionable_by_city: Boolean(data.actionable_by_city),
    referral: data.referral ? String(data.referral) : null,
    confidence: String(data.confidence ?? 'low'),
    needs_more_info: data.needs_more_info ? String(data.needs_more_info) : null,
  };
}
