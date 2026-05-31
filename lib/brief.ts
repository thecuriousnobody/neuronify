import { getSql } from './db';
import { callLLM, MODELS } from './ai';
import { AGENT_B_SYSTEM } from './agents';

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
};

// Deterministic totals are computed in code (accurate, defensible), and the
// prose ranking/merging narrative comes from Agent B.
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

  let markdown: string;
  if (residentCount === 0) {
    markdown = '_No triaged submissions yet for this session._';
  } else {
    // Feed Agent B the array of triage records, exactly as the doc prescribes.
    const payload = rows.map((r) => ({
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
    markdown = await callLLM({
      system: AGENT_B_SYSTEM,
      user: JSON.stringify(payload, null, 2),
      model: MODELS.brief,
      temperature: 0.3,
      maxTokens: 2200,
    });
    markdown = markdown.replace(/```markdown|```md|```/g, '').trim();
  }

  return { sessionId, residentCount, totalLow, totalHigh, byCategory, markdown };
}
