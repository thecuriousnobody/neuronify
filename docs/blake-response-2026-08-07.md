# Blake's review → what changed → how it's tested

**Date:** 2026-08-07 · **Branch:** `fix/blake-feedback-2026-08-07` (4 commits)
**Status:** built, unit-tested, typechecks, builds. **Not yet deployed or
browser-verified.** See "What still needs a human" at the bottom.

Source: Blake's testing review of the live route-direct intake. Triage against
the pre-existing known-gaps list is in `blake-feedback-plan-2026-08-07.md`.

---

## The one that reframed the work

Blake's §1.1 — a multi-fact opening message being discarded — read like it needed
an architecture change. His own §5.2 proposed one: treat the conversation as
filling a slot set rather than running a script of turns.

**The engine already works that way.** `missingRequired()` is a set difference
over the draft, and merges are keyed last-write-wins. There is no turn index and
no per-department question script anywhere.

The actual defect was one branch. When triage locked the category, the route
returned the triage reply and an **empty draft** — with a comment asserting that
history would carry the resident's description forward:

> *"The accumulated history carries the resident's initial description into the
> collection turns that follow, so nothing they've said is lost."*
> — `app/api/v2/converse/route.ts:72-74`, now deleted

History carried the *text*, but slots only fill from what the model extracts, and
the prompt scoped extraction to "the resident's latest message." So the message
that revealed the category was never mined, and every field came back missing.

The lock turn now runs a real collecting turn over that same message. Blake's
§2 batching then falls out for free, exactly as he predicted — and it is safe for
the reason he was uncertain about: a half-answered pair leaves the other slot
empty, and an empty slot is simply asked again. Partial answers self-heal.

---

## Side by side

| Blake | What we changed | Automated test | Manual case |
|---|---|---|---|
| **1.1** Multi-fact opener discarded | Category-lock turn now collects instead of returning an empty draft (`converse/route.ts`). Prompt told to mine the whole message | `intake.test.ts` — multi-fact opener fills every slot in one turn; `prompt.test.ts` — the rule survives refactors | **E1** |
| **1.2** Fake "add a photo later" promise | Prompt forbids promising post-filing upload; asks *why* instead and records the answer in the attachment slot. Review screen prefills from it | `intake.test.ts` — in-chat reason fills the slot and satisfies the requirement; `prompt.test.ts` — three separate assertions on the ban | **E3** |
| **1.3** Photos not viewable from tracking | Track page presigns server-side and renders them | `attachments.test.ts` — `attachmentPathname` as a signing gate | **E6** |
| **1.4** Mobile "too fast" after dictation | Rate limiter split into per-endpoint buckets — speech and chat no longer share one 1.5s gap. Composer restores input, thread, and chips on any failed send | `ratelimit.test.ts` — 8 cases incl. the exact dictate-then-send sequence | **E4** |
| **1.5 / 4.4** No transcript | `submitForm` takes a transcript; chat sends its history; server composes it | `service.test.ts` — verbatim storage, reconstruction from the log alone, empty→no event | **E9** |
| **§2** One question at a time drags | Up to two related short-answer questions per turn (`MAX_QUESTIONS_PER_TURN`) | `intake.test.ts` — partial answer leaves the other slot missing; `prompt.test.ts` — budget tracks the constant | **E2** |
| **4.1** Staff can't see photos | `lib/blob-read` signs short-lived reads; `/api/desk/attachment` redirects an `<img>` behind the desk cookie | `attachments.test.ts` — foreign store, lookalike host, junk, store root all refused | **E5** |
| **4.2** Resolved address not at the desk | Desk record shows the geocoded address + coordinates under the resident's words, linked to a map | — (rendering) | **E7** |
| **4.3** "Intake Pothole" | One shared `prettyFormKey`, in the engine, replacing eight ad-hoc copies. Also fixes the stored workflow title | `labels.test.ts` — 7 cases incl. mid-key "intake" surviving | **E8** |
| **4.5** Landmark outranks later address | Prompt now says the newest, most specific answer wins; merge preserves the slot's photo and geocode | `intake.test.ts` — later specific value overwrites; extras survive re-extraction | (covered by E1) |
| **5.5** Emergency hard stop | New deterministic detector ahead of every model call. Breaks the flow, offers 911, never invents a utility number | `emergency.test.ts` — 13 cases, both directions | **E10** |

### Deliberately not built

| Item | Why |
|---|---|
| **5.1** Pre-submit confirmation summary | Already exists — the review screen shows every captured field, editable, before filing. Blake reached it in his run. Adding a second recap would be noise. What it was *missing* is now fixed: it prefills the photo reason (1.2) and the record shows the resolved address (4.2) |
| **A post-filing photo upload link** | Would make the "add it later" promise real rather than removing it. It mutates a filed record, needs a capability model on the reference number, and touches the append-only audit trail. Real work, worth doing, not a same-day change. We made the bot honest instead |
| **3.1 / 3.2 / 3.3 / 5.3 / 5.6 / 5.7 / 5.8 / 5.9** | Product direction, not defects. Third-party routing, SMS, the service catalog, duplicate detection, close-the-loop, WCAG, metrics. Scoped in the plan doc; each needs a design pass, not a patch |

---

## What kind of tests this repo actually runs

Worth being blunt, since this is the part you asked to understand.

**The runner is Node's built-in test runner with `tsx`. There is no vitest, no
jest, no Playwright, no CI.** The entire configuration is one line of
`package.json`, and nothing runs tests automatically — `npm test` is a thing a
human types.

```
"test": "node --import tsx --test $(find engine lib -name '*.test.ts')"
```

**133 tests, 16 files, all green, ~0.4s.** (Memory said ~65; it was 84 before
today and stale.)

| Area | Files | Tests |
|---|---|---|
| Intake conversation, prompt, triage, forms, taxonomy | 6 | 49 |
| Attachments + blob URL validation | 1 | 24 |
| Emergency hard stop | 1 | 13 |
| Workflow engine (reducer, graph, service, revise, metrics) | 5 | 28 |
| Geocoding | 1 | 9 |
| Rate limiting | 1 | 8 |
| Labels | 1 | 7 |

**Everything tested is pure.** The engine depends only on `Clock`, `IdGenerator`,
`Repository`, `Notifier`, and `LLM` interfaces, so tests inject a `ScriptedLLM`
(queued JSON responses), an `InMemoryRepository` (a real store, not a stub — it
`structuredClone`s both ways to prove the engine never mutates persisted state),
and a `FakeClock`. That is why the suite runs offline in under half a second and
why its assertions are about *our* logic rather than the model's mood.

### What is not covered, honestly

- **All 24 API routes have zero tests**, and the `find engine lib` glob cannot
  even reach `app/`. This includes every write path. It is why 8 of today's 11
  fixes carry a manual case: the *logic* under them is tested, the *wiring* is
  not.
- **No component or page tests at all.** No React testing library. Every UI
  change today — the photo thumbnails, the resolved-address row, the emergency
  card, the composer's input-restore — is verified only by eye.
- **`lib/` is 3 of 22 modules covered** (geocode, ratelimit, labels — the last
  two added today). The real Neon adapter in `lib/engine/repo.ts` has never been
  tested; only its in-memory reference implementation is.
- **`npm run lint` is a no-op.** `next lint` finds no ESLint config and drops
  into an interactive setup prompt. In CI it would hang.
- **There is no test database.** Local and production share one Neon instance, so
  every completed manual case files a real report into a real queue.

### Where I deliberately put logic to make it testable

The glob only reaches `engine/` and `lib/`, so anything left in a route is
untestable by construction. Three things were placed accordingly:

- `formatTranscript` → `engine/intake/conversation.ts`, not the submit route
- `attachmentPathname` → `engine/intake/attachments.ts`, not `lib/blob-read`
- `detectEmergency` → `engine/intake/emergency.ts`, with the route as four lines
  of wiring

That is also why the emergency detector could get 13 adversarial cases rather
than a smoke test.

---

## The emergency stop, specifically

It is the one piece here where a miss isn't recoverable, so it is built to three
rules and tested in both directions.

1. **It runs before any model call.** Not a prompt rule the model weighs against
   being helpful — a branch the model never sees. Prompts can be argued with.
2. **It breaks, it does not block.** Acknowledging carries you on to filing, per
   danger. A different danger still stops you. Real emergencies often warrant a
   report too.
3. **It never invents a phone number.** 911 is the only contact stated from our
   own knowledge. `EMERGENCY_CONTACTS` is empty, so copy reads "the gas utility's
   emergency line". A wrong number in front of someone smelling gas is worse than
   no number.

Tests cover the misses that matter (a downed line arriving disguised as a tree
report, which the taxonomy would happily file) *and* the noise that would ruin it
(fire hydrant, fire lane, downed tree branch, clogged storm drain). A warning
that fires on hydrants trains people to tap past the one that matters. Negation
is handled in both directions: "there are no downed wires" does not stop; "no
parking sign is over and a power line is down" does.

---

## What still needs a human

1. **Nothing is deployed.** Four commits sit on `fix/blake-feedback-2026-08-07`.
   Push → preview → run Phase E → ff-merge. Deploys are yours.
2. **Phase E has never been run.** 10 cases in `e2e-browser-tests.md`. E1, E4,
   E5 and E10 are the load-bearing ones. E5/E6 file real reports into the shared
   production queues — add them to the cleanup ledger (currently 8 test records).
3. **The photo viewer has never been exercised against a real blob.** The signing
   code is new and the SDK path (`issueSignedToken` with `operations: ['get']` →
   `presignUrl`) has never run in this project. It fails closed to "unavailable"
   rather than a broken image, but E5 is the case that proves it works at all.
4. **Emergency contact numbers must be filled in and dialled** before any pilot.
5. **Ask Blake to confirm (B)** — the photo skip-with-reason behaviour shipped
   2026-07-31 without his sign-off. His §1.2 implies he's fine with it *if the
   follow-up is real*; we removed the false promise rather than building the
   follow-up. He should agree that's the right trade.
6. **Transcript retention has open policy questions** — retention period, who may
   read it, and whether residents are told. `docs/transcript-retention.md`.

### Two things found along the way, not from Blake

- **`mergeDraft` clobbered a slot's photo and geocode** whenever the model
  restated its value. Not reachable in the current flow (photos live in client
  state until submit), so it was latent, not live. Fixed and tested.
- **Revising a location deliberately drops its geocode**, which looks like a bug
  and is not — the old pin is wrong once the address is rewritten. Left alone,
  now commented so nobody "fixes" it into a stale-pin bug. The genuine gap next
  to it: a revised address is never re-geocoded at all.
