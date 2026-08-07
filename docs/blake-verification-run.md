# Verification run — one sitting, in order

A single pass that proves every fix for Blake's feedback. Ordered so each run
sets up the next: **do them top to bottom** and you'll only file three reports
total while covering all eleven items.

Nothing here has been seen in a browser. Unit tests, typecheck and build are
green; every rendering change below is unverified. Assume something is broken
and you'll be in the right frame of mind.

---

## Before you start

```bash
git checkout fix/blake-feedback-2026-08-07
git push -u origin fix/blake-feedback-2026-08-07
```

**Test on the PREVIEW URL Vercel gives you, not neuronify.ai.** None of this is
on main. The preview shares the production database, so every report you file is
real — prefix all free text with `TEST — ` and add reference numbers to the
cleanup ledger (currently 8 records).

Have two tabs ready: the preview `/report/chat`, and the preview `/desk`
(passcode `public_works-2026`).

---

## RUN 1 — the big one

Covers Blake **1.1** (his worst), **§2**, **4.5**, **4.1**, **4.2**, **4.3**,
**1.3**, **1.5/4.4**.

### 1.1 — Say everything at once

Open `/report/chat`. As your **first** message, type all of this in one go:

> `TEST — there's a big pothole at Fry and Knoxville, right in the traffic lane, about the size of a dinner plate, cars are swerving around it`

**What Blake saw:** the bot ignored all of it and walked him back through every
question one at a time. He called this the most damaging thing he found — the
resident already did the work and we made them do it again.

**What you should see now:**
- It identifies Pothole → Public Works as before
- It does **not** ask where it is, how big it is, or which lane
- It asks only for something you genuinely didn't say, or jumps straight to
  "Review & finish"

**This is the one that matters most.** If it re-asks anything you just said,
stop and tell me — everything else is cosmetic next to this.

### §2 — Two questions, not twenty

Whatever it asks next, watch the shape.

**Expected:** at most **two** questions in one message, numbered, and only when
both have short answers. Never an address batched with anything else.

**Then deliberately answer only one of the two.** The other must come back. It
must not be quietly dropped — that was the risk Blake flagged, and the whole
reason batching is safe here is that an unanswered slot is just an empty slot.

### 4.5 — The address you actually gave

Note that you typed **"Fry and Knoxville"** — a misspelling, no street types.

**Expected:** it resolves to `Knoxville Ave & E Frye Ave`. If it offers "Not this
spot?" alternates, that's the geo-candidates feature working.

If you later give a *more specific* address, the newer one should win. Try
adding: `actually it's right outside 1200 N Knoxville Ave` and check the pin
follows.

### Now file it — with a photo

Go through to the review screen, attach any photo from your phone or desktop,
and file. **Write the reference number down.**

### 4.1 — Staff can finally see the photo

Open `/desk`, sign in, open the case you just filed.

**What Blake saw:** `photo attached — viewer coming soon`. Crews were *required*
to collect a photo they had no way to open.

**Expected:** the photo renders as a thumbnail in the record. Click it → full
size in a new tab.

⚠️ **This is the single most likely thing to be broken.** The signing code is
brand new and has never run against a real blob. If you see "preview
unavailable" instead of a broken image, that's it failing closed as designed —
tell me, because the likely cause is that the store's random filename suffix
uses a character my new allow-list rejects. That's a one-character fix, and the
check should be widened, never removed.

### 4.2 — The address the crew sees

Same case, look at the location row.

**What Blake saw:** staff got the raw words `Fry and Knoxville` while the
resident's own tracking page had the real pin. Stored all along, read by nobody.

**Expected:** your raw words, and directly underneath, `Knoxville Ave & E Frye
Ave` plus coordinates, linked to Google Maps.

### 4.3 — No internal namespace

Same screen, and the queue behind it.

**What Blake saw:** case titles reading **"Intake Pothole"**.

**Expected:** just **"Pothole"** — on the queue list, the case title, and the
detail panel. Search the page for "Intake " and find nothing.

### 1.5 / 4.4 — The conversation is kept

Same case → **Chat & change log** tab.

**What Blake saw:** "No intake transcript was preserved for this case."

**Expected:** your full conversation, your words and the assistant's, in order.

### 1.3 — The resident sees their own photo

Open `/track/<your reference number>`.

**What Blake saw:** no photo rendered.

**Expected:** the photo renders. The row does **not** show `—`.

---

## RUN 2 — the honest photo promise

Covers Blake **1.2**.

Fresh chat. Report something photo-required:

> `TEST — someone dumped a couch and two mattresses in the alley behind 300 SW Adams`

Answer its questions until it asks for a photo. Then say:

> `I can't take a photo`

**What Blake saw:** the bot said that was fine and he could add one later. On
submit, that context reached nothing — and there is no "later" mechanism at all,
so the promise was empty.

**Expected now:**
- It **never** says you can add one later, after filing, or once submitted
- It asks briefly *why* not — answer `my phone camera is broken`
- On the review screen, that reason is **already filled in**. You should not
  have to type it again
- Delete the pre-filled reason and it stays deleted (it used to be submitted
  anyway)
- Put it back, file it, and the desk record reads
  `No photo — resident said: "my phone camera is broken"`

---

## RUN 3 — the emergency hard stop

Covers **5.5**, which Blake didn't raise but flagged as pre-pilot. **Both
directions matter equally.**

### It must STOP — four fresh chats, first message each

1. `I smell gas near 4th and Main`
2. `a tree came down and there are downed power lines across the road`
3. `water main break on Sheridan`
4. `someone is hurt, they fell into the excavation`

**Expected each time:** the conversation breaks immediately. A red card, a
tappable **Call 911** button, and **no intake question follows**. The gas one
must tell you to *leave the area* before it tells you to call — check that
ordering specifically.

Then tap "I've done that" and confirm you can carry on filing normally, and that
the same warning doesn't fire again.

### It must NOT stop — these are ordinary reports

5. `TEST — the fire hydrant on my street is leaking`
6. `TEST — someone parked in the fire lane again`
7. `TEST — there is a downed tree branch blocking the sidewalk`
8. `TEST — a tree is down but there are no downed wires`

**Expected:** normal intake, no interruption.

A false stop is not harmless. A warning that fires on fire hydrants teaches
people to tap past the one that matters. Both a miss and a false alarm are
failures here.

**Note:** no utility phone numbers are configured, so the copy says "the gas
utility's emergency line" without a number. That's deliberate — I wouldn't write
numbers I couldn't verify. They must be filled in and dialled before a pilot.

---

## RUN 4 — mobile, and never losing your words

Covers Blake **1.4**. **Do this on an actual phone.**

### The throttle

Open `/report/chat` on your phone. Dictate a message with the mic, and hit send
**the instant** dictation finishes. Repeat three times.

**What Blake saw:** "Too fast — give it a second." on normal human behaviour,
forcing a full retype.

**Why it happened:** speech-to-text and chat shared one 1.5-second per-IP gap, so
dictating and then sending was two calls ~200ms apart and tripped it by
construction. They're separate buckets now.

**Expected:** no throttle error.

### The worse half — losing your input

Blake noted the throttle was annoying but *losing the typed message* was the real
bug. Test it directly:

1. Turn on airplane mode
2. Type a full sentence
3. Hit send

**Expected:**
- An error appears
- **Your sentence is still in the composer**, ready to resend
- The failed message isn't left stranded in the thread as if it went through

Bonus: start typing a second thought *while* a normal message is in flight, then
kill the network. Both pieces of text should survive, not just the newer one.

---

## Quick reference — Blake's item → where you check it

| Blake | Run | One-line check |
|---|---|---|
| 1.1 Multi-fact opener discarded | 1 | First message with 4 facts — nothing re-asked |
| 1.2 Fake "add photo later" | 2 | Never promises; asks why; prefills the reason |
| 1.3 No photo on tracking | 1 | `/track/<ref>` shows the photo, not `—` |
| 1.4 "Too fast" + lost input | 4 | Dictate→send OK; airplane mode keeps your text |
| 1.5 No transcript | 1 | Desk → Chat & change log tab has the conversation |
| §2 One question at a time drags | 1 | Max two, numbered; half-answers come back |
| 4.1 Staff can't see photos | 1 | Thumbnail in the desk record ⚠️ most likely to fail |
| 4.2 Resolved address missing | 1 | Real address + coords under the raw words |
| 4.3 "Intake Pothole" | 1 | Reads "Pothole" everywhere |
| 4.5 Landmark beats later address | 1 | "Fry and Knoxville" → Frye; later address wins |
| 5.5 Emergency stop | 3 | 4 must stop, 4 must not |

---

## What to send me back

- **Anything that re-asks a fact you already gave** (Run 1) — highest priority
- **Whether the desk photo actually rendered** — the one genuine unknown
- Every reference number you created, for the cleanup ledger
- Any wording a resident would find confusing

## Not covered by this run

- **`5.1` confirmation summary** — the review screen already does this; Blake
  reached it. Nothing new to test.
- **Desk scoping** — any signed-in desk can open any case, including its photos
  and transcript. Pre-existing, but higher stakes now. That's a decision, not a
  test.
- **Blake's §3 product direction** (third-party routing, SMS, service catalog,
  duplicates, close-the-loop, WCAG, metrics) — design work, not built.
