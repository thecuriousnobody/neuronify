# Neuronify

**Your city's nervous system.** Residents speak one issue → an AI agent triages it
(category, urgency, the real municipal fix, a planning-level cost) → at the end of a
session it produces a ranked, costed one-page brief for the city council.

Built for **AI Collective Peoria**. Live at **neuronify.ai**.

> Community signal in. A costed plan out.

---

## Stack

- **Next.js (App Router)** on **Vercel**
- **Neon** (Postgres) for data — the live wall uses fast polling (Neon has no realtime socket)
- **Provider-agnostic AI** — defaults to **Groq** (free, OpenAI-compatible Llama models);
  one env var swaps to **Anthropic Claude** or a local **Ollama**
- Plain CSS + CSS Modules, "Synapse" design tokens (see `app/globals.css`)

## Routes

| Route | What |
|---|---|
| `/` | Landing page |
| `/speak` | Public submission — mobile-first, voice (Web Speech API) + text. QR target. |
| `/wall` | Live projected screen — polls the feed, fires a node per signal, runs the counter |
| `/brief/[sessionId]` | The council brief — deterministic totals + Agent B's ranked prose |
| `/api/submit` | POST a submission → save → Agent A triage → write back |
| `/api/feed` | GET session feed (summaries only, never raw text) — polled by `/wall` |
| `/api/brief` | POST `{ sessionId }` → Agent B brief |
| `/api/session` | GET current session · POST starts a fresh one |

The two community-editable surfaces (categories + cost table) live in
`lib/agents.ts`, verbatim from the baseline doc.

## Local setup

```bash
npm install
cp .env.example .env.local      # fill in DATABASE_URL + GROQ_API_KEY
npm run db:setup                # applies db/schema.sql to Neon
npm run dev                     # http://localhost:3000
```

`npm run db:setup` reads `DATABASE_URL` from the environment. If it's only in
`.env.local`, run it explicitly:

```bash
DATABASE_URL="postgres://..." npm run db:setup
```

## Environment

See `.env.example`. Minimum to run:

- `DATABASE_URL` — Neon pooled connection string
- `AI_PROVIDER=groq` + `GROQ_API_KEY` — free key from <https://console.groq.com/keys>

To use Claude instead: `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`.
To run fully local/free: `AI_PROVIDER=ollama` (run `ollama serve`; no key).

## Demo-day flow

1. Project `/wall` on the big screen.
2. Residents scan a QR → `/speak` → say or type one issue → **Send signal**.
3. A node fires on the wall within ~1.2s; the summary slides into the feed.
4. Operator clicks **Generate brief** → `/brief/[sessionId]` renders the ranked, costed page.

## Privacy

Submissions are **anonymous**. We store only `raw_text` (what was said) — never names,
emails, or phone numbers. Cost figures are illustrative national ballparks, labeled as
planning-level illustration, not engineering quotes.

## Built in public

Neuronify is built in the open, in Peoria. The **engine is open source** (MIT — see
[`LICENSE`](LICENSE)); the brand, the hosted service, the data, and the connector network
are stewarded by the maintainers. See [`OWNERSHIP.md`](OWNERSHIP.md) for the honest breakdown.
Contributions welcome — contribution is membership.
