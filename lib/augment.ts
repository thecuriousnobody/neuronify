import { callLLM, parseLooseJSON, MODELS } from './ai';

export type AugmentResult = {
  cleaned: string;
  category: string;
  prior_art: string | null;
  branch: string;
  confidence: 'high' | 'medium' | 'low';
};

const SYSTEM = `You are the live ideation partner for the Distillery Labs Ideation Club. A person has just spoken one idea, out loud, in a fast and messy stream. Turn that raw transcript into one structured, generative record.

You will be given:
- transcript: what they said
- existing_lanes: the lane names already on the board

Do the following:

1. CLEAN: restate the idea in one sharp sentence. Preserve the specific detail and the spark — do NOT flatten it into something generic. Keep the concrete noun, the place, the move.

2. CATEGORY: assign it to the single best lane from existing_lanes. If none fit, propose a short new lane name (2-3 words). Return the lane name as a string.

3. PRIOR_ART: in one line, does this already exist in the world? Name it ("this exists as X") or give the closest analog ("closest analog: Y"). If genuinely novel or you're unsure, say so plainly. Never bluff.

4. BRANCH: propose exactly ONE adjacent idea this could give birth to — the next mutation, not a restatement. Keep it short and provocative.

5. CONFIDENCE: high | medium | low — your confidence that you understood the idea.

OUTPUT RULES — CRITICAL:
Output ONLY raw JSON. No markdown, no code fences, no preamble. First character {, last character }.

Schema:
{
  "cleaned": "one sharp sentence",
  "category": "best existing lane name, or a new short one",
  "prior_art": "one line, or null if truly novel",
  "branch": "one adjacent idea it could spawn",
  "confidence": "high | medium | low"
}`;

export async function augment(
  transcript: string,
  existingLanes: string[],
): Promise<AugmentResult> {
  const raw = await callLLM({
    system: SYSTEM,
    user: JSON.stringify({ transcript, existing_lanes: existingLanes }),
    model: MODELS.augment,
    temperature: 0.4,
    maxTokens: 512,
  });

  const data = parseLooseJSON<Partial<AugmentResult>>(raw);

  const confidence = ['high', 'medium', 'low'].includes(data.confidence ?? '')
    ? (data.confidence as 'high' | 'medium' | 'low')
    : 'medium';

  return {
    cleaned: String(data.cleaned ?? transcript).slice(0, 500),
    category: String(data.category ?? 'General').slice(0, 100),
    prior_art: data.prior_art ? String(data.prior_art).slice(0, 300) : null,
    branch: String(data.branch ?? '').slice(0, 300),
    confidence,
  };
}
