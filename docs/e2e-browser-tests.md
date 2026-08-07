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

## Phase D — 2026-07-31 additions

These test the day's shipped features. Most are observable during the SAME
conversation as Phase A — run them together, file nothing extra.

### D1 · Quick-reply chips (schema + agent-suggested)

**Do:** During any report conversation, watch below the thread after each agent
question.

**Expect:**
- Choice questions (road position, size) show their options as tap-able chips
- Yes/no questions show chips
- The agent also offers PREDICTED chips on questions without fixed choices,
  when likely answers exist (e.g. an either/or it posed in its own words)
- Open questions (the first description, a street address) may rightly have none
- Tapping a chip sends it as a normal message; typing still works

**Fail if:** chips never appear, a chip sends the wrong text, or chips linger
on a question they don't answer.

---

### D2 · The agent never claims to file ⚠️ *regression — observed live*

The model once said *"I'm sending this to our street repair team right now."*
with three fields still unanswered — the resident waits forever.

**Do:** In conversation, watch every agent reply until the "I've got what I
need" card.

**Expect:** while anything is still missing, every reply ends with a question;
no reply ever says it is sending/filing/submitting the report.

**Fail if:** any mid-conversation reply wraps up without a question, or claims
the report has been sent.

---

### D3 · Address candidates — "Not this spot?"

**Do:** Give a location. After the 📍 line appears, look under it.

**Expect:**
- The 📍 pin is in Peoria (or no pin at all) — NEVER another town ⚠️
  *(regression: "north side median" once pinned Rome, IL, 15 miles away)*
- When the geocoder had alternates, a "Not this spot?" row of tap-able
  addresses appears; tapping one moves the pin
- A single-candidate location legitimately shows no alternates row

**Fail if:** the pin names a town other than Peoria / Peoria Heights, or
tapping an alternate doesn't update the 📍 line.

---

### D4 · Photo escape hatch, resident side

Covered by A5 (block requires BOTH photo and reason missing; reason input
present). Do NOT file a reason-only report just to test — the desk rendering
is checked in D6 against an existing record.

---

### D5 · Chat follows the conversation

**Do:** Hold a conversation past one screen of messages.

**Expect:** after each reply (and when chips render), the view lands with the
composer fully visible — no manual scroll needed to type.

**Fail if:** you have to scroll to reach the input box.

---

### D6 · Desk shows both photo states *(read-only, existing records)*

**Do:** Sign in to Public Works. Open these existing records:
- `0aa912e4-1075-4d25-b27c-cb5896cdd18e` (filed WITH a photo)
- `96d6e904-cf36-4b81-8db4-ee89a89a674b` (filed with a REASON instead)

**Expect:**
- With photo: the photo row reads **"(photo attached — viewer coming soon)"**
- With reason: **"No photo — resident said: “phone camera broken”"**

**Fail if:** either shows the old blanket "(attachment — upload coming soon)",
or the reason is missing.

---

### D7 · Desk sign-in eye toggle

**Do:** On `/desk`, click the eye icon in the passcode field before signing in.

**Expect:** passcode toggles visible/masked; icon switches between eye and
eye-off; sign-in still works.

---

### D8 · Old doors are unlinked but alive

**Do:** On the landing page, check every resident-facing link. On `/desk`
(signed in), check the header.

**Expect:**
- Every landing "Speak up"/"File a report"/"Speak" link goes to `/report/chat`
- No "Front desk →" link in the desk header
- Direct URLs `/report` and `/desk/intake` still load (retirement pending)

**Fail if:** any resident-facing link still targets `/report`, or the direct
URLs 404.

---

## Phase E · Blake's 2026-08-07 review

Everything in this phase is a fix for something Blake hit in a live run-through
or flagged as a gap. Run E1 first — it is the one he called the most damaging.

Automated coverage exists for the logic underneath each of these (133 unit
tests); what these cases prove is the wiring, which no unit test in this repo can
reach. See `docs/blake-response-2026-08-07.md` for the mapping.

### E1 · The opening message is not thrown away

**Do:** Start a fresh chat. As your FIRST message, say several things at once:
`TEST — there's a big pothole at Knoxville and Frye, right in the traffic lane,
about the size of a dinner plate`.

**Expect:**
- The category is detected (Pothole → Public Works) as before
- The assistant does **not** ask where it is, how big it is, or which lane
- It asks only for what you genuinely did not say, or goes straight to review

**Fail if:** it asks you to repeat any fact from that first message. This is the
regression that matters most in this phase.

### E2 · Related questions may arrive two at a time

**Do:** Continue E1 until it asks for something short (a yes/no or a choice).

**Expect:**
- At most TWO questions in one message, numbered, and only when both are
  short-answer
- Never a batched pair that includes an address or a free description
- Answer only ONE of the two: the other must be asked again, not lost

**Fail if:** three or more questions arrive at once, or answering one of two
quietly drops the other.

### E3 · The photo promise is honest

**Do:** Reach a photo-required category (pothole). When asked for a photo, say
`I can't take a photo`.

**Expect:**
- The assistant never says you can add one later, after filing, or "once it's
  submitted" — there is no such mechanism
- It asks briefly why not, and accepts the answer
- Your reason appears already filled in on the review screen — you should not
  have to type it a second time
- After filing, the desk record reads `No photo — resident said: "…"`

**Fail if:** it promises a later upload, or your reason does not reach the record.

### E4 · Dictating then sending is not throttled, and nothing is ever eaten

**Do:** On a phone: dictate a message with the mic, and hit send the instant
dictation finishes. Repeat three times.

**Expect:** no "Too fast — give it a second." Speech and chat are now separate
buckets.

**Then, to check the other half:** turn airplane mode on, type a sentence, hit
send.

**Expect:**
- An error appears
- Your typed sentence is **still in the composer**, ready to resend
- The failed message is not left stranded in the thread

**Fail if:** normal dictate-then-send is throttled, or any failure costs you your
typed words. Losing input is the worse half of this bug.

### E5 · Staff can open the photo

**Do:** File a report with a photo (note the reference), then open it on the
desk.

**Expect:** the photo renders in the record as a thumbnail. Clicking it opens
full size in a new tab. No "viewer coming soon" text anywhere.

**Fail if:** a placeholder, a broken image, or a 401/404 in the network tab.

### E6 · The resident can see their own photo

**Do:** Open `/track/<reference>` for the report from E5.

**Expect:** the photo renders. The row does not read `—`.

**Fail if:** an em dash, or a broken image.

### E7 · Staff see the resolved address, not just the words

**Do:** On the desk record from E5, look at the location row.

**Expect:** the resident's raw words, and beneath them the geocoded address
(`Knoxville Ave & E Frye Ave`) plus coordinates, linked to a map.

**Fail if:** only the raw words appear — that was the B3 partial from 2026-07-31.

### E8 · No internal namespace on the staff side

**Do:** Look at the desk queue, the case title, and the detail panel.

**Expect:** `Pothole`, never `Intake Pothole`. Check the workflow title too.

**Fail if:** `Intake ` appears anywhere a human reads.

### E9 · The conversation is preserved

**Do:** On the desk record from E5, open the **Chat & change log** tab.

**Expect:** the full conversation, your words and the assistant's, in order.

**Fail if:** "No intake transcript was preserved for this case."

### E10 · The emergency hard stop

**Do — it must STOP (four separate fresh chats):**
1. `I smell gas near 4th and Main`
2. `a tree came down and there are downed power lines across the road`
3. `water main break on Sheridan`
4. `someone is hurt, they fell into the excavation`

**Expect:** each breaks the conversation immediately with a red interruption, a
tappable **Call 911** link, and no further intake questions. The gas one must
tell you to leave the area **before** it tells you to call. Tapping "I've done
that" lets you carry on; the same warning does not fire again, but a different
one still does.

**Do — it must NOT stop (these are ordinary reports):**
5. `the fire hydrant on my street is leaking`
6. `someone parked in the fire lane again`
7. `there is a downed tree branch blocking the sidewalk`
8. `a tree is down but there are no downed wires`

**Expect:** normal intake, no interruption.

**Fail if:** any of 1–4 proceeds to a form question, or any of 5–8 is
interrupted. Both directions are failures — a warning that fires on hydrants
trains people to tap past the one that matters.

**Note:** no utility phone numbers are configured yet, so the copy reads "the gas
utility's emergency line" without a number. That is deliberate, not a bug — see
`EMERGENCY_CONTACTS` in `engine/intake/emergency.ts`. Numbers must be filled in
and dialled-checked before any pilot.

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
| D1 | Quick-reply chips | | |
| **D2** | **Agent never claims to file** | | |
| **D3** | **Pin never leaves town + candidates** | | |
| D5 | Chat follows to the composer | | |
| D6 | Desk renders both photo states | | |
| D7 | Passcode eye toggle | | |
| D8 | Old doors unlinked, still alive | | |
| **E1** | **Opening message is not thrown away** | | |
| E2 | Two related questions may batch | | |
| E3 | Photo promise is honest | | |
| **E4** | **Dictate→send not throttled; input never eaten** | | |
| **E5** | **Staff can open the photo** | | ref: |
| E6 | Resident can see their own photo | | |
| E7 | Staff see the resolved address | | |
| E8 | No internal namespace on the staff side | | |
| E9 | Conversation is preserved on the case | | |
| **E10** | **Emergency hard stop — both directions** | | |

**Bold rows are the ones that have broken before, or that are new and
load-bearing.** If you run a short version, run those.

### Also report

- Every reference number you created, so the queues can be cleaned up
- Any wording from the agent that a resident would find confusing
- Anything that looked wrong but wasn't covered by a case
