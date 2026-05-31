import { getSql } from './db';
import { callLLM, MODELS } from './ai';
import { AGENT_B_SYSTEM, AGENT_C_SYSTEM } from './agents';
import { serperSearch, type SearchHit } from './serper';

export type SubmissionRow = {
  id: string;
  summary: string | null;
  category: string | null;
  severity: string | null;
  intervention: string | null;
  cost_low_usd: number | null;
  cost_high_usd: number | null;
  cost_basis: string | null;
  actionable_by_city: boolean | null;
  referral: string | null;
  confidence: string | null;
  needs_more_info: string | null;
};

export type BriefResult = {
  sessionId: string;
  residentCount: number;
  totalLow: number;
  totalHigh: number;
  byCategory: { category: string; count: number; low: number; high: number }[];
  markdown: string;
  actions: string | null;
  sources: SearchHit[];
};

function toPayload(rows: SubmissionRow[]) {
  return rows.map((r) => ({
    summary: r.summary,
    category: r.category,
    severity: r.severity,
    intervention: r.intervention,
    cost_low_usd: r.cost_low_usd,
    cost_high_usd: r.cost_high_usd,
    cost_basis: r.cost_basis,
    actionable_by_city: r.actionable_by_city,
    referral: r.referral,
    confidence: r.confidence,
    needs_more_info: r.needs_more_info,
  }));
}

// Agent B — the ranked, costed council brief.
async function runBriefWriter(rows: SubmissionRow[]): Promise<string> {
  const md = await callLLM({
    system: AGENT_B_SYSTEM,
    user: JSON.stringify(toPayload(rows), null, 2),
    model: MODELS.brief,
    temperature: 0.3,
    maxTokens: 1800,
  });
  return md.replace(/```markdown|```md|```/g, '').trim();
}

// Agent C — SERPER-grounded proactive action proposals. Runs at brief-time
// only, bounded to a handful of searches. Fails soft (returns null actions).
async function enrich(rows: SubmissionRow[]): Promise<{ actions: string | null; sources: SearchHit[] }> {
  if (!process.env.SERPER_API_KEY) return { actions: null, sources: [] };

  // Top interventions by how many residents raised them.
  const byIntervention = new Map<string, { intervention: string; count: number }>();
  for (const r of rows) {
    const key = (r.intervention || '').toLowerCase().trim();
    if (!key) continue;
    const e = byIntervention.get(key) || { intervention: r.intervention as string, count: 0 };
    e.count += 1;
    byIntervention.set(key, e);
  }
  const top = [...byIntervention.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  if (top.length === 0) return { actions: null, sources: [] };

  const searches = await Promise.all(top.map((t) => serperSearch(`${t.intervention} cost`, 4)));

  // Category summary for the planner.
  const byCat = new Map<string, { count: number; interventions: Set<string> }>();
  for (const r of rows) {
    const c = r.category || 'other';
    const e = byCat.get(c) || { count: 0, interventions: new Set<string>() };
    e.count += 1;
    if (r.intervention) e.interventions.add(r.intervention);
    byCat.set(c, e);
  }
  const catSummary = [...byCat.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([c, v]) => `- ${c}: ${v.count} resident(s) — interventions: ${[...v.interventions].join('; ')}`)
    .join('\n');

  const searchContext = searches
    .map((s) => {
      const lines = [`[${s.query}]`];
      if (s.answer) lines.push(`  answer: ${s.answer}`);
      s.hits.forEach((h) => lines.push(`  - ${h.title}: ${h.snippet}`));
      return lines.join('\n');
    })
    .join('\n\n');

  const sources = searches.flatMap((s) => s.hits).filter((h) => h.link).slice(0, 8);

  try {
    let actions = await callLLM({
      system: AGENT_C_SYSTEM,
      user: `CATEGORY SUMMARY:\n${catSummary}\n\nWEB SEARCH RESULTS (use only these for external figures):\n${searchContext}`,
      model: MODELS.brief,
      temperature: 0.4,
      maxTokens: 1200,
    });
    actions = actions.replace(/```markdown|```md|```/g, '').trim();
    return { actions: actions || null, sources };
  } catch {
    return { actions: null, sources };
  }
}

// Deterministic totals are computed in code (accurate, defensible). Agent B
// writes the ranked prose; Agent C adds SERPER-grounded proactive actions.
export async function generateBrief(sessionId: string): Promise<BriefResult> {
  const sql = getSql();
  const rows = (await sql`
    select id, summary, category, severity, intervention,
           cost_low_usd, cost_high_usd, cost_basis,
           actionable_by_city, referral, confidence, needs_more_info
    from submissions
    where session_id = ${sessionId} and status = 'triaged'
    order by created_at asc
  `) as SubmissionRow[];

  const residentCount = rows.length;
  const totalLow = rows.reduce((s, r) => s + (r.cost_low_usd ?? 0), 0);
  const totalHigh = rows.reduce((s, r) => s + (r.cost_high_usd ?? 0), 0);

  const byCatMap = new Map<string, { count: number; low: number; high: number }>();
  for (const r of rows) {
    const cat = r.category ?? 'other';
    const acc = byCatMap.get(cat) ?? { count: 0, low: 0, high: 0 };
    acc.count += 1;
    acc.low += r.cost_low_usd ?? 0;
    acc.high += r.cost_high_usd ?? 0;
    byCatMap.set(cat, acc);
  }
  const byCategory = [...byCatMap.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.count - a.count);

  if (residentCount === 0) {
    return {
      sessionId,
      residentCount,
      totalLow,
      totalHigh,
      byCategory,
      markdown: '_No triaged submissions yet for this session._',
      actions: null,
      sources: [],
    };
  }

  // Brief writer and the grounded action planner run concurrently.
  const [markdown, enrichment] = await Promise.all([runBriefWriter(rows), enrich(rows)]);

  return {
    sessionId,
    residentCount,
    totalLow,
    totalHigh,
    byCategory,
    markdown,
    actions: enrichment.actions,
    sources: enrichment.sources,
  };
}
