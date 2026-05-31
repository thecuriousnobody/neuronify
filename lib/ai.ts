// Provider-agnostic LLM layer.
// Default: Groq (free, OpenAI-compatible). Flip AI_PROVIDER to use Claude
// or a local Ollama without touching call sites.

const PROVIDER = (process.env.AI_PROVIDER || 'groq').toLowerCase();

type LLMOpts = {
  system: string;
  user: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
};

function providerConfig() {
  switch (PROVIDER) {
    case 'anthropic':
      return {
        kind: 'anthropic' as const,
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
      };
    case 'ollama':
      return {
        kind: 'openai' as const,
        baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
        apiKey: process.env.LLM_API_KEY || 'ollama',
      };
    case 'openai':
    case 'openai-compatible':
      return {
        kind: 'openai' as const,
        baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
        apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
      };
    case 'groq':
    default:
      return {
        kind: 'openai' as const,
        baseURL: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY || process.env.LLM_API_KEY || '',
      };
  }
}

// Sensible model defaults per provider; override via env.
export const MODELS = {
  triage:
    process.env.AGENT_A_MODEL ||
    (PROVIDER === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'llama-3.1-8b-instant'),
  brief:
    process.env.AGENT_B_MODEL ||
    (PROVIDER === 'anthropic' ? 'claude-sonnet-4-6' : 'llama-3.3-70b-versatile'),
};

export async function callLLM({
  system,
  user,
  model,
  temperature = 0.2,
  maxTokens = 1800,
}: LLMOpts): Promise<string> {
  const cfg = providerConfig();

  if (cfg.kind === 'anthropic') {
    const res = await fetch(`${cfg.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.content?.[0]?.text ?? '';
  }

  // OpenAI-compatible: Groq, Ollama, OpenAI, etc.
  const res = await fetch(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

// Defend the parse, per the baseline doc's standing lesson: strip stray
// code fences, then fall back to slicing the outermost braces.
export function parseLooseJSON<T = any>(raw: string): T {
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    const s = clean.indexOf('{');
    const e = clean.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) {
      return JSON.parse(clean.slice(s, e + 1)) as T;
    }
    throw new Error('Could not parse JSON from model output');
  }
}
