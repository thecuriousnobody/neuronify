// Thin SERPER (google.serper.dev) search client. Used at brief-time only to
// ground cost figures and inform proactive action proposals. Fails soft:
// returns empty results rather than throwing, so the brief always renders.

export type SearchHit = { title: string; snippet: string; link: string };
export type SearchResult = { query: string; answer: string | null; hits: SearchHit[] };

export async function serperSearch(query: string, num = 4): Promise<SearchResult> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { query, answer: null, hits: [] };
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, num }),
    });
    if (!res.ok) return { query, answer: null, hits: [] };
    const data = await res.json();
    const answer: string | null = data?.answerBox?.answer ?? data?.answerBox?.snippet ?? null;
    const hits: SearchHit[] = (data?.organic ?? []).slice(0, num).map((o: any) => ({
      title: String(o?.title ?? ''),
      snippet: String(o?.snippet ?? ''),
      link: String(o?.link ?? ''),
    }));
    return { query, answer: answer ? String(answer) : null, hits };
  } catch {
    return { query, answer: null, hits: [] };
  }
}
