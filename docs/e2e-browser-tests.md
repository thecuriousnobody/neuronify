# Neuronify — End-to-End Browser Test Script

**For a browser agent (Claude in Chrome).** Written to be executed step by step
without further instruction. Every case states what to do, what to expect, and
what counts as a failure.

Last updated 2026-07-28, for the smart-intake / route-direct build.

---

## Before you start

**Read this whole section. It contains rules that change how you execute.**

### What this build does

A resident opens `/report/chat`, talks to an agent, and the agent works out what
kind of report it is, routes it to the owning Peoria department, asks that
category's specific questions, resolves the address to real coordinates, takes a
photo, and files the report **straight to the department** — with no staff
confirm gate in between. The resident gets a reference number.

### Ground rules

1. **Every completed report is REAL.** There is no test database — local and
   production share one. A filed report persists and opens a live workflow in a
   department queue. Do not file more than each case requires.

2. **Mark all test data.** Begin every free-text answer with `TEST —` so a human
   scanning the queue can tell your reports from a resident's. Example:
   `TEST — automated check, safe to delete.`

3. **Wait 2 seconds between form submissions.** The API enforces a 1.5 s minimum
   gap per IP (`MIN_GAP_MS`), on top of 20 requests/minute. Clicking faster
   returns `429 Too fast — give it a second.` If you see that error, you moved
   too quickly — wait and retry; it is not a bug unless it appears after a
   deliberate 2 s pause.

4. **The agent is a live LLM.** Its wording will differ run to run. Judge by
   meaning, not by exact string match, except where a case quotes exact text.

5. **Record every reference number** you generate. They go in the results table
   at the bottom and are how anyone cleans up after you.

6. **Stop and report** if: a page 500s, a request hangs over 30 s, you get the
   same failure 3 times, or you are about to do anything not written here.
   Do not improvise fixes or explore unrelated pages.

7. **Do not** click anything labelled delete, deny, or resubmit in the city-side
   queues unless a case explicitly tells you to. Those write to an append-only
   ledger and cannot be undone.

### What you need

| | |
|---|---|
| Base URL | `https://neuronify.ai` (or `http://localhost:3001` if testing locally) |
| Desk passcodes | **Ask the operator — do not guess.** Needed for Phase B only. |
| A test photo | Any small JPEG/PNG on disk. Needed for A6 and A8. |

### Preconditions

- [ ] The build under test is deployed (commits through `fix(engine): don't relay a raw form key`).
- [ ] `/report/chat` loads without error.
- [ ] You have desk passcodes if running Phase B.

---

## Phase A — Resident intake (`/report/chat`)

### A1 · Cold load

**Do:** Open `/report/chat` in a fresh tab.

**Expect:**
- **Neuronify** brand mark with a glowing cyan dot top-left (links home), `Peoria, IL` top-right
- A centred hero (first load only — it collapses after the first message):
  monospace eyebrow `REPORT AN ISSUE`, headline **"What needs *fixing?*"**
  (with *fixing* italic cyan), and a one-line sub
- One assistant bubble: *"Hi — I can help you report something to the city…"*
- Bottom composer: round mic button, `Speak or type…` field, `Send` button
- Dark background with a soft cyan glow; **no green buttons, no solid-blue bubbles**

**Fail if:** the page is light-themed, buttons are green, the brand mark or hero
is missing, or the greeting is missing.

---

### A2 · Category detection on the first turn

**Do:** Type and send:
> `TEST — there's a big pothole on North Sheridan Road near Bradley University, cars are swerving around it.`

**Expect:**
- Your message appears right-aligned in a **cyan-tinted** bubble (not solid blue)
- A centred card appears reading **IDENTIFIED / Pothole / → routed to Public Works**
- The header top-right changes to `Pothole · routed to Public Works`
- The agent replies asking a follow-up question (usually about the exact location)

**Fail if:** no IDENTIFIED card appears, or the department is anything other than
Public Works.

---

### A3 · Correcting a mis-read category

**Do:** On the IDENTIFIED card, click **"Not right? Change it"**. Choose
**Graffiti** from the picker.

**Expect:**
- A new IDENTIFIED card: **Graffiti / → routed to Police**
- Header becomes `Graffiti · routed to Police`
- The agent acknowledges the switch and continues
- Answers that still apply (e.g. location) are kept; pothole-only answers are dropped

**Then:** Reload the page and redo A2 to get back to a pothole. (Category switching
mid-test will confuse later cases.)

**Fail if:** the picker doesn't open, is empty, or the department doesn't change.

---

### A4 · Address → real coordinates

**Do:** When the agent asks where it is, answer with a deliberately loose
intersection:
> `TEST — it's at Fry and Knoxville.`

**Expect:**
- A line appears under the header: 📍 `Location found: …`
- The resolved address **corrects the spelling** — expect something like
  `Knoxville Ave & E Frye Ave, Peoria, IL 61604` (note **Frye**, not Fry)

**Fail if:** no 📍 line appears, or the address comes back unresolved. That means
Google geocoding is not answering — report it, do not continue to A8.

---

### A5 · The photo requirement is real — but never a wall ⚠️ *key regression test*

Pothole is one of 8 photo-critical categories. The policy (as of 2026-07-31):
a photo is required, **but a resident who can't provide one may skip it by
recording a reason** — the report always files; the reason travels to the crew.

**Do:** Answer the agent's remaining questions (road position, size, hazard) until
the **"I've got what I need"** card appears. Click **Review & finish**. On the
review screen, **do not attach a photo** and leave the reason input empty. Click
**Finish**.

**Expect:**
- Submission is **blocked**
- An error appears: *"This kind of report needs a photo — add one above, or tell
  us why you can't provide one."*
- The photo field's hint reads **"(required for this kind of report…)"**, NOT "(optional…)"
- Below the picker there is a text input: *"Can't provide a photo? Tell the crew why…"*
- You remain on the review screen

**Do NOT test the reason path by filing** — that would create an extra real
report. The reason input's presence plus the block above is the check. (The
reason path itself is covered by unit tests server-side.)

**Fail if:** the report files with neither photo nor reason, the hint says
"optional", or the reason input is missing.

---

### A6 · Review screen shape *(regression test)*

**Do:** Stay on the review screen from A5. Inspect it.

**Expect:**
- Every answer the conversation collected is present and editable
- **"What's going on?" is a multi-line textarea (about 4 rows), not a one-line input.**
  This regressed once — a long description was invisible past the first line.
- Choice fields (`Where on the road?`, `Roughly how big?`) are dropdowns with
  sensible values; `Is it a safety hazard?` is Yes/No
- Required fields carry a red asterisk

**Then:** Edit the description — append ` [edited]`. You will confirm this survives in A8.

**Fail if:** the description is a single-line input, or any collected answer is missing.

---

### A7 · Photo upload

**Do:** On the review screen, use the photo field to attach your test image.

**Expect:**
- Brief `Uploading…` state
- A thumbnail preview appears in place of the file input
- No error banner

**Fail if:** you see *"Photo upload isn't available right now"* or any 503. That
means Blob storage is misconfigured — report it.

---

### A8 · File the report *(writes a real record)*

**Do:** Click **Finish**.

**Expect:**
- Button shows `Filing your report…` while it works
- The done screen appears: glowing ✓, **"Your report is complete"**
- `Pothole · routed to Public Works`
- The 📍 resolved address
- Every field, **including your `[edited]` change from A6**
- Your photo thumbnail
- *"This has gone straight to Public Works — no desk in between."*
- **"Your reference number is `<uuid>`"**

**Record the reference number.** You need it for B2 and B4.

**Fail if:** no reference number appears, the `[edited]` text is missing, or the
screen still says *"Submission is the next step to wire"* (that is the old build —
the deploy hasn't landed).

---

### A9 · A category with no photo requirement

**Do:** Fresh tab, `/report/chat`. Send:
> `TEST — loud amplified music from an event downtown, it's happening right now.`

Answer through to review, attach **no photo**, and Finish.

**Expect:**
- Detected as **Noise Complaint → routed to Police**
- The review screen has **no photo field at all**
- It **files successfully without a photo** (contrast with A5)
- A reference number

**Record the reference number** for B1.

**Fail if:** a photo is demanded, or the department isn't Police.

---

## Phase B — City side

Needs desk passcodes. Ask the operator.

### B1 · The noise complaint reached Police

**Do:** Open `/desk`, sign in to the **Police** queue.

**Expect:** Your A9 report is in the queue, identifiable by its `TEST —` text.

**Fail if:** absent after a refresh, or it landed in a different department.

---

### B2 · The pothole reached Public Works — with no gate in front of it

**Do:** Sign in to the **Public Works** queue. Find your A8 report.

**Expect:**
- It is present and **awaiting Public Works' own sign-off**
- It is **NOT** sitting in a front-desk / intake / clerk step

This is the point of the whole build: the report went straight to the department.

**Fail if:** the report is parked in an intake or clerk step — route-direct has
regressed.

---

### B3 · The department got a complete, actionable report

**Do:** Open the A8 record.

**Expect:** the structured fields (road position, size, hazard), the resolved
address with coordinates, and the photo — not just a blob of transcript text.

**Fail if:** fields are missing or the record is transcript-only.

---

### B4 · Resident-visible tracking

**Do:** Open `/track/<reference number from A8>`.

**Expect:** the record and its current status render for an anonymous visitor.

**Fail if:** it 404s or demands a sign-in.

---

### B5 · No internal keys in resident-facing text ⚠️ *key regression test*

The "we received it" note used to read *"We received your
`intake_noise_complaint` and started review."*

**Do:** Anywhere the resident-facing message or notification for your A8/A9
reports is visible (tracking page, receipt, SMS if enabled), read it.

**Expect:** plain language — *"We received your pothole and started review."*

**Fail if:** you see `intake_`, `_report`, or any underscored key in text a
resident would read.

---

## Phase C — Guardrails and polish

### C1 · Mobile

**Do:** Resize to 390 × 844. Reload `/report/chat` and walk to the review screen.

**Expect:** single column, no horizontal scrolling, tap targets ≥ 44 px, composer
reachable, review card fits.

---

### C2 · Reduced motion

**Do:** Enable `prefers-reduced-motion` and reload.

**Expect:** the cyan glow and the completion node stop pulsing. Nothing else breaks.

---

### C3 · Rate limiting is graceful

**Do:** On a fresh report, click **Send** twice in rapid succession (under 1 s).

**Expect:** a readable message — *"Too fast — give it a second."* — not a crash,
not a silent hang, not a duplicate report.

---

## Results

Fill this in and hand it back.

| Case | What it proves | Pass | Notes / reference number |
|---|---|:--:|---|
| A1 | Page loads in the right skin | | |
| A2 | Category detected + routed on turn 1 | | |
| A3 | Resident can correct a mis-read | | |
| A4 | Address → real coordinates, typo-tolerant | | |
| **A5** | **Photo requirement is enforced** | | |
| A6 | Review screen is complete and editable | | |
| A7 | Photo upload works | | |
| **A8** | **A report can actually be filed** | | ref: |
| A9 | Non-photo category files cleanly | | ref: |
| B1 | Reached the right department | | |
| **B2** | **No staff gate — route-direct** | | |
| B3 | Department gets structured data | | |
| B4 | Resident can track it | | |
| **B5** | **No internal keys shown to residents** | | |
| C1 | Mobile | | |
| C2 | Reduced motion | | |
| C3 | Rate limiting is graceful | | |

**Bold rows are the ones that have broken before.** If you run a short version,
run those.

### Also report

- Every reference number you created, so the queues can be cleaned up
- Any wording from the agent that a resident would find confusing
- Anything that looked wrong but wasn't covered by a case
