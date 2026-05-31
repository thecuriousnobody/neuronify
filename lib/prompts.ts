import { getSql } from './db';
import { AGENT_A_SYSTEM, AGENT_B_SYSTEM, AGENT_C_SYSTEM } from './agents';

// The editable agents. The code constant is the default; a DB row overrides it.
export const PROMPT_DEFS = [
  {
    key: 'agent_a',
    label: 'Agent A — Triage',
    hint: 'Runs on every submission. The categories and the cost reference table live in here.',
    default: AGENT_A_SYSTEM,
  },
  {
    key: 'agent_b',
    label: 'Agent B — Council brief',
    hint: 'Ranks and costs all submissions into the one-page brief.',
    default: AGENT_B_SYSTEM,
  },
  {
    key: 'agent_c',
    label: 'Agent C — Action planner',
    hint: 'Proposes proactive, web-grounded civic actions in the brief.',
    default: AGENT_C_SYSTEM,
  },
] as const;

const DEFAULTS: Record<string, string> = Object.fromEntries(
  PROMPT_DEFS.map((p) => [p.key, p.default]),
);

export function isValidPromptKey(key: string): boolean {
  return PROMPT_DEFS.some((p) => p.key === key);
}

// Effective prompt for an agent: DB override if present, else the code default.
// Fails soft to the default so a DB hiccup never breaks triage/brief.
export async function getPrompt(key: string): Promise<string> {
  try {
    const sql = getSql();
    const rows = (await sql`select content from agent_prompts where key = ${key}`) as {
      content: string;
    }[];
    if (rows[0]?.content) return rows[0].content;
  } catch {
    /* fall through to default */
  }
  return DEFAULTS[key] ?? '';
}

export type PromptView = {
  key: string;
  label: string;
  hint: string;
  content: string;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export async function getAllPrompts(): Promise<PromptView[]> {
  let rows: { key: string; content: string; updated_at: string; updated_by: string | null }[] = [];
  try {
    rows = (await getSql()`select key, content, updated_at, updated_by from agent_prompts`) as any;
  } catch {
    /* table may not exist yet — show defaults */
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return PROMPT_DEFS.map((p) => {
    const r = byKey.get(p.key);
    return {
      key: p.key,
      label: p.label,
      hint: p.hint,
      content: r?.content ?? p.default,
      isDefault: !r,
      updatedAt: r?.updated_at ?? null,
      updatedBy: r?.updated_by ?? null,
    };
  });
}

export async function setPrompt(key: string, content: string, by: string | null): Promise<void> {
  if (!isValidPromptKey(key)) throw new Error('Unknown prompt key');
  await getSql()`
    insert into agent_prompts (key, content, updated_by, updated_at)
    values (${key}, ${content}, ${by}, now())
    on conflict (key) do update
      set content = excluded.content, updated_by = excluded.updated_by, updated_at = now()
  `;
}

// Reset to the code default by removing the override.
export async function resetPrompt(key: string): Promise<void> {
  if (!isValidPromptKey(key)) throw new Error('Unknown prompt key');
  await getSql()`delete from agent_prompts where key = ${key}`;
}
