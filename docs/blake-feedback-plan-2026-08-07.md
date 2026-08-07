# Blake Feedback — Triage & Build Plan (2026-08-07)

Source: Blake's testing review of the live route-direct intake (received 2026-08-07).
State baseline: main `ab5ba70`, prod verified 2026-07-31. See memory
`neuronify-next-build-intake.md` for the known-gaps ledger this triage was run against.

Workflow for all code waves: branch → Vercel preview → browser-verify → ff-merge to main.
Deploy = git push only. Prod DB is shared — every filed report is real.

---

## Triage: known vs. new

| Blake item | Status | Maps to |
|---|---|---|
| 1.1 multi-fact opener discarded | **NEW — most damaging (his words)** | Root cause family of A4; real fix is §5.2 slot architecture |
| 1.2 deferred-photo promise not honored | **NEW** | Adjacent to the photo escape hatch (`dbb361e`) — investigate whether the freeform "add it later" path bypassed the recorded-reason slot |
| 1.3 track page shows no photo | KNOWN | "Track photo row shows —" (evening e2e finding #2) |
| 1.4 mobile "too fast" error eats input | **NEW** | Rate-limit quirk was known (prod-ops memory); *losing the composer text on error* is new and is the worse half |
| 1.5 / 4.4 no transcript on chat filings | KNOWN | Evening finding #4 — P4 only wired the old voice path |
| §2 batch related questions | **NEW** design change | Falls out of §5.2 for free |
| 3.1 third-party route-out w/ direct email | Extends KNOWN | Supersedes the never-built `water_external` refer-out gap; Blake generalizes it into a differentiator |
| 3.2 SMS second channel | **NEW** — design constraint now, feature later | engine/ isolation already helps; audit for channel assumptions |
| 3.3 + 5.3 fewer categories, service catalog as data | **ANSWERS open question (A)** | Ties directly to the unscheduled city-admin-console roadmap item ("new service on a Tuesday = a row, not a deploy") |
| 4.1 staff photo viewer | KNOWN | Top of polish list already; same signed-URL root cause as 1.3 — **one fix, two surfaces (confirm)** |
| 4.2 resolved address not on desk | KNOWN | Evening finding #1 — stored, just not surfaced |
| 4.3 "Intake Pothole" desk title | KNOWN | One-liner, same fix as track eyebrow |
| 4.5 landmark outranks later address | KNOWN | A4 — resolved correctly on retest, still open |
| 5.1 pre-submit confirmation summary | **NEW — cheapest trust-builder** | Also mitigates 1.1/1.2/4.5 while the big refactor is pending |
| 5.2 slot-filling architecture | **NEW — the big one** | Fixes 1.1 by construction, enables §2 batching, makes corrections first-class (A4 class) |
| 5.4 transcript = records/retention question | **DECIDES 4.4: retain** | Not purely product; default keep + written retention policy |
| 5.5 emergency 911 hard-stop | **NEW — build before first pilot** | `confirmSafetyCritical` flag exists but that's a clerk-confirm, NOT a 911 break-out — different thing |
| 5.6 duplicate detection → one work order, N subscribers | NEW — roadmap | Great demo moment ("eleven people reported this") |
| 5.7 close-the-loop status notification | NEW — roadmap | Pairs with 3.2 SMS; anonymous flow currently has only the track link |
| 5.8 WCAG audit | NEW — roadmap | Pointed, given we take ADA sidewalk complaints |
| 5.9 metrics (zero-touch %, time-to-division, abandonment by turn, 3rd-party volume) | NEW — instrument early | Abandonment-by-turn is the data that settles §2 empirically |
| pol.is (Rajeev's add) | Evaluate, low priority | See bottom |

### Open Blake questions — updated status
- **(A) 22-category granularity → ANSWERED**: fewer resident-facing categories; hundreds-of-services lives as a *routing catalog the classifier maps into* (5.3). Resident never picks a category.
- **(B) photo policy → still not explicitly answered.** 1.2 implies he's fine with soft-skip *if the follow-up promise is real*. The escape hatch (skip + recorded reason) shipped 2026-07-31 without his sign-off — confirm with him it matches his intent. Don't treat as closed.
- **(C) dept map → partially answered**: 3.1 is the answer for water/utilities (third-party route-out, not a staffed desk). rats→Code Enforcement still unconfirmed.
- **(E) other_inquiry catch-all → implicitly keep** under the 5.3 model (classifier needs a fallback), but not explicitly confirmed.

---

## Build plan — waves

Waves 1–4 and 6 are small-to-medium and independent; each is one branch. Wave 5 is the
big engine refactor — do it on Opus with orchestration, after the quick wins are banked.

### Wave 1 — quick fixes (one branch)
1. **4.3** Desk title "Intake Pothole" → clean label. Same one-liner pattern as the track-eyebrow fix (B5).
2. **4.2** Surface geocoded address + coords on the desk record (`app/desk/[submissionId]/page.tsx`). Data already stored; render it next to the resident's raw words.
3. **1.4** Composer must NEVER discard input on error — keep text in the box on any failed send, show retriable error. Separately tune the rate-limit/debounce so send-at-dictation-end doesn't trip it (check the known rate-limit quirk in prod-ops memory first).
4. **1.2 short-term** — stop the bot promising "you can add it later" unless that's real. Investigate: the photo escape hatch stores a skip reason; find out why Blake's "can't provide one" path produced no carried-over context (likely the agent freelanced a promise outside the escape-hatch slot). Minimal fix: prompt constraint + ensure any skip routes through the recorded-reason mechanism.

### Wave 2 — photo viewer via signed URLs (one branch)
- **4.1 + 1.3 together.** Server-side signed URLs from the private blob store; render on BOTH the desk record (replace the hardcoded "(attachment — upload coming soon)" at `app/desk/[submissionId]/page.tsx:326`) and the resident track page (photo row currently "—").
- Verify it's genuinely one root cause per Blake's note; confirm both surfaces on preview with a real filed photo before merge.
- Security: signed URLs short-lived; desk side is behind passcode, track side is behind the reference-number capability URL — don't leak permanent public URLs.

### Wave 3 — transcript persistence (one branch)
- **4.4/1.5, decision per 5.4: RETAIN.** Send `/report/chat` history to `submit-anon`, store on the record, render on desk via the existing P4 transcript pattern from the old voice path.
- Write a short internal retention-policy note (docs/) — "easier to defend keeping than to explain deleting."
- Watch payload size limits on submit; transcript is append-only once filed (audit-trail principle).

### Wave 4 — pre-submit confirmation summary (5.1) (one branch)
- Before filing: "Here's what I've got — anything I should change?" + compact recap of captured fields (category, location as *resolved* address, description, photo state incl. skip reason).
- Resident can correct before submit; corrections update the fields (at minimum: re-open the relevant question).
- This is the stopgap that catches 1.1/1.2/4.5-class silent data loss until Wave 5 lands. Interacts with the false-wrapup guard — the guard blocks premature "filed!" claims; the summary becomes the sanctioned wrap-up path.

### Wave 5 — slot-filling engine refactor (THE BIG ONE — Opus + orchestration)
Reframe the conversation as filling a visible slot-set, not a script of turns (5.2):
- Bot only asks for slots still empty → **1.1 fixed by construction** (multi-fact opener populates several slots at once).
- **§2 batching**: when several related slots are empty, ask 2–3 together (Blake's cap: ≤3, beyond that stay sequential). Chips still work per-slot.
- Corrections/later answers overwrite slots → kills the **A4/4.5** wrong-source class.
- Keep: category lock, dept-keyed required fields, false-wrapup guard, photo escape hatch semantics, geo candidates.
- Instrument **abandonment-by-turn (5.9)** in the same wave — it's the metric that proves whether batching wins.
- This is a substantial engine/ change: design doc first, then build. Respect the one-way engine boundary. Consider grill-me or a Plan-agent pass before code.

### Wave 6 — emergency hard-stop (5.5) (one branch; before any pilot)
- Detect life-safety language (gas odor, downed line, water main break, active flooding, injury) → immediately break flow, show 911 / utility-emergency guidance, do NOT continue collecting a service request.
- Distinct from `confirmSafetyCritical` (clerk-confirm flag) — this is a resident-facing hard stop.
- Decide: still capture a minimal record after the redirect ("we told resident to call 911 at HH:MM") — leaning yes, it's the audit trail.
- Needs careful test cases; false positives ("my mailbox got flooded with ads") matter.

### Roadmap (design docs / later — not this cycle)
- **3.1 third-party route-out**: capture → acknowledge resident with third party's contact + process → email third party directly with full details. Needs: outbound email infra, third-party contact registry (data, per 5.3 catalog), tracking of third-party volume (5.9). Replaces the `water_external` stub. Real differentiator — schedule soon after Wave 5.
- **3.3/5.3 service catalog as data**: divisions (small fixed set) + service rows + per-service conditional field definitions in DB. Converges with the city-admin-console roadmap item — likely the same build. This is the second-city unlock.
- **3.2 SMS**: near-term action is only an *audit* of engine/ for channel assumptions (rich UI, chips, photo upload) so the port stays cheap. Chips/photos need SMS-degradable equivalents.
- **5.6 duplicate detection**: proximity + service type → one work order, N subscribers; staff sees report count.
- **5.7 close-the-loop**: status notifications on the filing channel. Pairs with SMS.
- **5.8 WCAG audit** of /report/chat + track pages before procurement asks.
- **5.9 metrics**: zero-touch %, median time-to-correct-division, abandonment by turn, third-party volume. Cheap logging can start in Waves 1–5 as touched.

### pol.is (https://pol.is)
Open-source deliberation/opinion-clustering platform (Computational Democracy Project —
vTaiwan etc.). Honest read: its problem space is *collective opinion sensing*, not service
-request intake — small direct overlap with 311. Two genuinely useful borrowings:
1. Clustering/aggregation ideas feed **5.6 duplicate detection** and the "eleven people
   reported this" staff signal.
2. A sentiment/opinion layer could be a separate civic-engagement surface later (adjacent
   to the Vishnu soft-signal brief) — not core 311.
Recommendation: 1-hour evaluation spike, notes to docs/, no integration this cycle.

---

## Suggested execution order
1. Wave 1 (quick fixes) — high visible-polish per token.
2. Wave 2 (photos) — Blake's top-of-list, crews blocked on it.
3. Wave 3 (transcript) — decided; unlocks the records story.
4. Wave 4 (confirm summary) — stopgap for the 1.1 class.
5. Wave 6 (emergency stop) — small, must precede pilot.
6. Wave 5 (slot engine) — the big orchestrated build, with 5.9 instrumentation.
7. Roadmap design docs (3.1, 5.3 catalog) as planning sessions.

## Reply to Blake — points to send back
- Photo viewer, resolved-address, title, transcript: already queued; his report confirms priority. Transcript: adopting his retain-by-default position.
- (A) adopting his fewer-categories / catalog-as-data direction.
- (B) explicitly confirm: photo skip-with-reason (shipped) — does that match his intent, given 1.2?
- (C) confirm rats→Code Enforcement; water route-out becomes 3.1 third-party pattern.
- 1.1/§2: agreeing, fix is the slot architecture; confirmation summary ships sooner as the safety net.
- Emergency hard-stop: agreed, pre-pilot gate.
