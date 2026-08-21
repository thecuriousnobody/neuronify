# Fix plan — capture + location, 2026-08-18

Branch: **`fix/intake-capture-and-location-2026-08-18`**, cut from `main` @ `a1b2fa5`.

**This document is the source of truth for this work.** It is written so a session
with no prior context can execute it. Findings 5, 6 and 7 in
`docs/e2e-run-2026-08-17.md` are the evidence behind it.

## Why these four, together

All three defects Rajeev found on 2026-08-18 sit on the path between *what a
resident said* and *where a crew drives*. Individually small; together they are
the difference between a crew arriving and a crew arriving 5.8 miles away.

The full 50-case E2E passed every one of them, because it used unambiguous
phrasing and typed rather than spoke. **Rajeev's two voice sessions found more
than the whole automated pass did.** Any test written here must use his phrasing,
not mine.

---

## Fix 1 · `description` is not captured even when supplied ⚠️ highest value

**Symptom.** A voice report read back *"a large pothole at Knoxville and Fry, in
the traffic lane, and it's a safety hazard"*, then asked **"One more thing —
What's going on?"** — asking for the very thing it had just recited.

**Root cause is NOT yet established. Do not assume.** What is known: the model
clearly held the content (it is in the read-back) but `description` was empty in
the draft, so `missingRequired` kept it and the wrap-up guard fired.

Hypotheses to test, in order:
1. The prompt tells the model to extract into slots but the read-back path lets it
   "use" content without writing `description`.
2. `description`/`What's going on?` has no explicit instruction to be filled from
   the opening narrative, so the model treats it as a question it has not yet
   asked rather than a slot it can fill from what it already heard.
3. Voice transcripts arrive as one long turn and extraction favours the specific
   fields (lane, size, hazard) over the general one.

**Start here:** `engine/intake/prompt.ts` (extraction rules) and
`engine/intake/conversation.ts` (`mergeDraft`, `missingRequired`). Reproduce first
with a unit test at the engine seam before touching the prompt.

**Test to write:** an opener describing the problem in prose must populate
`description`. Use Rajeev's actual sentence.

---

## Fix 2 · The wrap-up guard appends instead of replacing — the turn contradicts itself

**Location:** `engine/intake/conversation.ts:~147`.

```js
if (!ready && !reply.includes('?')) {
  const q = `One more thing — ${next.label.replace(/\?+\s*$/, '')}?`;
  reply = reply ? `${reply} ${q}` : q;   // ← appends
}
```

**Two problems:**
1. The model's false wrap-up ("You're all set to review and submit your report")
   survives, immediately followed by the question that contradicts it. The guard
   should **suppress the wrap-up claim**, not decorate it.
2. The appended question pastes the raw field label. *"One more thing — What's
   going on?"* reads like a form, not a person.

**Also weak:** `!reply.includes('?')` is a crude readiness probe — any rhetorical
question in the reply defeats the guard entirely. Consider detecting
wrap-up/filing *claims* rather than the absence of a `?`.

**Careful:** this guard exists because of a real incident (the bot claimed
*"I'm sending this to our street repair team right now"* with three fields empty).
**Do not weaken it.** It must still fire; it should just produce a coherent turn.
`D2` in `docs/e2e-browser-tests.md` is the regression case.

---

## Fix 3 · Geocode the resident's verbatim phrase, not a rewritten one

**Evidence** (probed live against `/api/v2/geocode`, see Finding 5):

| query | candidates |
|---|---|
| `Knoxville and Frye` | **2 — `N Frye Rd` FIRST**, `E Frye Ave` |
| `Frye and Knoxville` | 1 — `E Frye Ave` |
| `Fry and Knoxville` | 1 — `E Frye Ave` |
| `Knoxville and North Frye` | 1 — `N Frye Rd` |

Peoria has two Knoxville/Frye intersections **~5.8 miles apart** (40.796 vs
40.712). Word order and spelling decide which you get.

**`lib/geocode.ts` is correct — do not "fix" it.** `pickCandidates` preserves
provider ranking; `geocodeApprox` takes `[0]`. The damage is upstream: when a
reordered/re-spelled phrase reaches the geocoder, two candidates collapse into
one, so the "Not this spot?" row has nothing to show and the resident is never
offered the corner they meant.

**Do:** establish what string is actually being geocoded (verbatim vs extracted),
then geocode the verbatim phrase. **Open question Rajeev was asked and has not yet
answered: what the "Where is it?" field read on his report — his words or a
rewrite.** If verbatim, the cause is elsewhere and this fix changes shape.

---

## Fix 4 · Alternates must be named in terms a resident holds ⚠️ NEEDS RAJEEV

**His point, and it invalidates the obvious fix.** Standing at that corner you see
a sign reading **Frye Ave** and one reading **Knoxville Ave**. The compass prefix
is a mapping artefact. *"Did you mean N Frye Rd or E Frye Ave?"* is unanswerable
by the person actually standing there.

This also weakens the **existing** "Not this spot?" row, which today renders
`N Frye Rd & Knoxville Ave` against `Knoxville Ave & E Frye Ave` — exactly the
distinction he cannot resolve.

**Options (Rajeev's call, do not pick unilaterally):**
- **A. Two pins on a small map, tap the right one.** No naming at all. Best for
  the person standing there; most build.
- **B. Anchor to a landmark or neighbourhood** — "near Northwoods Mall" vs "near
  Bradley University". Requires a reverse lookup for a nearby POI.
- **C. Plain-language direction** — "north Peoria" vs "near downtown". Cheapest;
  weakest for someone who doesn't think in compass terms either.

Recommendation: **A**, with **B** as the text fallback where a map can't render.

---

## Ground rules for this work

- **Every filed report is real** — local and prod share one database. Prefer unit
  tests at the engine seam over browser filings. If a filing is unavoidable,
  record the reference in `docs/e2e-run-2026-08-17.md`.
- **Do not push or merge.** `main` is live on neuronify.ai. Rajeev merges.
- Full suite must stay green: `npm test` (183 at branch point), `npm run
  typecheck`, `npm run build`.
- **Never run `npm run build` while `npm run dev` is running** — it clobbers
  `.next` and the dev server starts 500ing. Cost time on 2026-08-17.
- Test with **Rajeev's phrasing, spoken-style**, not clean typed strings. That gap
  is precisely why the E2E missed all three.

## Not in scope

The chips-linger-after-category-switch defect (Finding 1) and the "voice" mislabel
(Finding 4) are real but separate. Do not fold them in.

---

# Results — overnight run, 2026-08-18 → 19

Fixes 1–3 are DONE, committed (`d79b4fa`, `27757ea`), verified live at the
engine seam against the real model and geocoder. **Nothing was filed** — no
browser, no submissions; the shared DB was only read. Fix 4 is prepped and
awaiting Rajeev's call. 197 tests green (183 at branch point + 14 new),
typecheck clean, production build clean.

## Fix 1 — root cause established, then fixed

Reproduced live 6/6 before touching anything: the real model on the real
pothole form, given the spoken-style opener, extracts location + size +
road_position + hazard and leaves `description` empty — then asks for it.
Hypothesis 2 was correct: nothing told the model the opening narrative IS the
description. Three layers now, tested at each level:

1. **Field-level hint on longtext fields** — the decisive one. A rules-list
   instruction alone measurably did nothing (still 4/4 empty). With the hint on
   the field itself, the model extracts `description` 4/4 near-verbatim and
   stops asking for it. The hint also insists the same words still fill the
   specific fields — without that clause, road_position and size migrated INTO
   the description and got skipped (caught live, 3/4).
2. **Prompt rule** for the narrative → description relationship (kept; harmless
   reinforcement).
3. **Engine backstop in `runIntakeTurn`** — the guarantee, since prompts are
   advisory: a fact-bearing opener (≥1 other field extracted from it) whose
   required longtext is still empty banks the opener **verbatim** as the
   description. Resident's own words, no paraphrase — which also chips at
   Finding 3 for the backstop case.

## Fix 2 — the guard now suppresses instead of decorating

`stripWrapUpClaims` drops the sentences that falsely claim wrap-up/filing
(only consulted while fields are missing, when any such claim is false by
definition); the readiness probe is now ends-with-`?` instead of
`includes('?')`, so a rhetorical "sound good?" cannot defeat it; the appended
question is the field's label as a bare question — no "One more thing —"
pasting. The original incident case ("I'm sending this to our street repair
team right now") still fires the guard and stays tested.

## Fix 3 — the open question is ANSWERED, and the fix changed shape as predicted

**The filed report's location was Rajeev's phrase VERBATIM.** The stored
transcript of `e905fb7f…` shows him saying "I see a pothole at Frye Avenue and
Knoxville Avenue" — extraction rewrote nothing (and the fresh 6-trial live run
kept "Knoxville and Fry" verbatim every time). The collapse is the
**provider's word-order and suffix sensitivity**:

| his phrase, probed | candidates |
|---|---|
| `Frye Avenue and Knoxville Avenue` (as filed) | 1 — E Frye Ave only |
| swapped order | 1 — the "Avenue" suffix excludes the N Frye **Rd** corner |
| bare of suffixes, either order | 2 — both corners |

So `geocodeCandidates` now expands an intersection phrase into up to four
queries — both word orders, plus both orders bare of street-type suffixes —
in parallel, merged through the existing `pickCandidates` dedup. The
resident's own order stays first, so the auto-pin is unchanged; extra queries
only ever ADD alternates. `pickCandidates`/ranking untouched, per the warning
above. A prompt rule additionally pins location extraction to the resident's
verbatim phrasing. Verified live: the exact filed phrase now yields both
corners; plain addresses and unambiguous intersections unchanged.

## Fix 4 — DONE. Rajeev chose A (map pins, landmark fallback) from his phone

Both alternates rows (chat and review screen) are now a `CandidateMap`: the
candidates as lettered pins on a small auto-fit map, with pick buttons named
in resident terms — for the two Frye corners, **"A — near McDonald's" vs
"B — near Kroger"**. The formal street name survives only as a hover title.

Pieces, all fail-soft (a dead map hides; labels degrade landmark → direction →
distinct street name):
- `app/api/v2/staticmap` — proxies Google Static Maps so the key stays
  server-side; strict `parsePins` validation and its own rate-limit bucket
  (`staticmap` — no min-gap, or the image 429s for arriving right after the
  geocode call that produced it).
- `lib/landmarks.ts` — labels via Places API **v1** `searchNearby`,
  **POPULARITY** ranking, 700 m radius. Two live findings that shaped it: the
  legacy Places endpoint is not enabled on this project (REQUEST_DENIED), and
  the dedicated `GOOGLE_PLACES_API_KEY` 403s on v1 while `GOOGLE_MAPS_API_KEY`
  is entitled — both keys are tried in order, so fixing the Places key's
  permissions later just works. DISTANCE ranking was probed and rejected: the
  nearest POI to a corner is a random office listing ("Buckingham Jeffrey K");
  the popular one is the Kroger people navigate by.
- `labelCandidates` enrichment in `converse` + `geocode` routes (only when >1
  candidate); duplicate labels fall back to distinct street names.

**Browser-verified end-to-end on localhost, nothing filed** (conversation
abandoned at the review screen): opener with the ambiguous corner → map +
both labeled buttons render in chat → tapping "B — near Kroger" moves the pin
to N Frye Rd → review screen shows the same picker inside the location field,
selection preserved, "this is where the crew will go" tracking it. The same
run also showed Fix 1 live: the bot recited all four opener facts and asked
only for size — no "What's going on?" re-ask.

## Rajeev's phone pass on the preview (2026-08-19) — three findings, all fixed

The stable test link **`neuronify-preview.vercel.app`** was set up at his
request (Vercel alias; re-point after every push — see the deploy-preference
memory). His voice run on it confirmed the opener capture and the corner
picker working end to end, and found:

1. **Picker layout** — on a phone the wrapping row orphaned choice B under
   the label. Now: label on its own line, one full-width choice per line.
2. **The map only appeared on a conflict.** His point: it should also confirm
   a clean capture. Now every resolved location shows a map — one candidate
   renders as a street-level confirmation pin (no letter, no picker row).
3. **"Can you share a photo of the pothole?" directly above "I've got what I
   need."** — the mirror image of Fix 2's contradiction. Chat cannot accept a
   file, so when the engine is ready and only an attachment remains,
   `redirectAttachmentAsks` (engine/intake/conversation.ts) replaces the
   impossible ask with "You can add a photo on the review screen." The
   "why can't you take one?" question survives — chat handles that flow.
4. **A mistranscribed corner pinned a whole road with full confidence** —
   "Knoxville and Wall, near War Memorial" (speech-to-text slip) pinned the
   middle of W War Memorial Dr. Decision (Rajeev's): do NOT chase
   transcription accuracy — the visible map + cheap correction is the
   systemic defense. The one principled addition: **street-grade honesty**.
   Google's result `types` distinguish a `route` match from a real corner;
   when the resident's phrase was corner-shaped but the pin is only
   street-grade, the location card and the review screen say so plainly and
   point at the fix ("say the cross-streets again" / "edit the address").
   Flag computed in lib/geocode.ts (`isStreetGrade` + `cornerShaped`),
   stripped when the resident only named a street — a road pinned as a road
   is faithful and gets no warning.
