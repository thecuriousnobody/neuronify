# Brief for the browser agent

> **⚠️ PARTIAL — scoped to Blake's 2026-08-07 items only.** It does not cover
> the address/pin fix (Phase F), find my report (Phase G), or the retention
> notice + outbox drain (Phase H), all of which landed later on the same branch.
> **For a complete pass, point the agent at `docs/e2e-browser-tests.md` and ask
> for Phases A–H** — that doc names the preview URL and the SSO gate itself.

Paste this to whatever drives Chrome. It is deliberately narrow: the agent runs
what a machine runs well, and hands back the things only a person can judge.

---

## The brief

> You are testing a civic 311 web app on a preview deployment. Base URL:
> `https://neuronify-git-fix-blake-feedback-2026-08-07-the-idea-sandbox.vercel.app`
>
> **Ground rules, all of them hard:**
> - Every completed report is REAL — local and production share one database.
>   **File at most 2 reports total.** Never file one unless a step says to.
> - Prefix all free text with `TEST — `.
> - Wait 2 seconds between messages.
> - Record the reference number of anything you file.
> - Do not click any `tel:` link.
> - If something fails, capture a screenshot and the browser console, then carry
>   on to the next numbered step. Do not retry more than twice, and do not go
>   exploring outside the steps below.
>
> **Report back a table: step number, PASS/FAIL, and what you actually saw.**
> Quote the assistant's exact wording rather than paraphrasing it.
>
> ### Step 1 — the opening message must not be re-asked
> Open `/report/chat`. Send as the FIRST message, verbatim:
> `TEST — there's a big pothole at Fry and Knoxville, right in the traffic lane, about the size of a dinner plate, cars are swerving around it`
> Record the assistant's full reply.
> PASS if it does NOT ask where it is, how big it is, or which lane. FAIL if it
> asks for any of those. Quote the reply either way.
>
> ### Step 2 — question batching
> Continue answering. For each assistant turn, count the question marks.
> PASS if no reply contains more than 2 questions. Note whether batched pairs
> are numbered, and whether any batched question asked for an address.
>
> ### Step 3 — a half-answered pair recovers
> If a reply asks two questions, answer only the FIRST. PASS if the second is
> asked again on a later turn. If no reply ever batches, mark N/A.
>
> ### Step 4 — later, more specific address wins
> Send: `TEST — actually it's right outside 1200 N Knoxville Ave`
> Report what address the page shows as the resolved location afterwards.
>
> ### Step 5 — file it with a photo
> Reach the review screen. Report every field and its value. Attach any image
> file, then file the report. **Record the reference number.**
>
> ### Step 6 — desk record
> Open `/desk`, sign in with department `public_works`, passcode
> `public_works-2026`. Open the report from step 5. Report:
> a) Does a photo THUMBNAIL render in the record? (This is the highest-value
>    answer in the whole run.) If not, what appears instead, and what does the
>    Network tab show for `/api/desk/attachment`?
> b) Is there a resolved street address AND coordinates under the location?
> c) Search the page text for `Intake `. Report every occurrence.
> d) Open the "Chat & change log" tab. Is the conversation there, or does it say
>    "No intake transcript was preserved"?
>
> ### Step 7 — resident tracking
> Open `/track/<reference number from step 5>`. Does the photo render, or does
> the row show a dash?
>
> ### Step 8 — the emergency stop MUST fire
> For each message below, open a NEW chat and send it as the first message.
> **Do not file anything in these chats.**
> 1. `I smell gas near 4th and Main`
> 2. `a tree came down and there are downed power lines across the road`
> 3. `water main break on Sheridan`
> 4. `someone is hurt, they fell into the excavation`
> For each: PASS if a red warning card appears with a "Call 911" button and NO
> follow-up intake question. Quote the card's text for #1 and confirm whether
> "leave the area" appears BEFORE "call 911" in it.
>
> ### Step 9 — the emergency stop MUST NOT fire
> Same method, new chat each time. **Do not file anything.**
> 5. `TEST — the fire hydrant on my street is leaking`
> 6. `TEST — someone parked in the fire lane again`
> 7. `TEST — there is a downed tree branch blocking the sidewalk`
> 8. `TEST — a tree is down but there are no downed wires`
> PASS if each proceeds to normal intake with NO warning card. A false alarm
> here is as much a failure as a miss in step 8.
>
> ### Step 10 — hedged phrasing must still stop
> New chat: `I'm not sure but I think I smell gas`
> PASS if the warning card appears. This one is subtle and matters.
>
> ### Step 11 — no photo, honest handling
> New chat: `TEST — someone dumped a couch and two mattresses in the alley behind 300 SW Adams`
> Answer until it asks for a photo, then send: `I can't take a photo`
> Report the exact reply. PASS if it does NOT offer to let you add a photo
> later/after filing/once submitted, and instead asks why not.
> Answer `my phone camera is broken`, go to review, and report whether that
> sentence is ALREADY pre-filled in the reason box. Then clear that box and
> report whether the Finish button blocks you. **Do not file this one.**

---

## What the agent cannot do — keep these for yourself

| Check | Why it needs a person |
|---|---|
| **Dictate → send throttle** (Blake 1.4) | Needs a real phone mic and real timing |
| **Airplane mode keeps your typed text** | Needs OS-level network control |
| **Mobile layout** | The 2026-07-31 run deferred C1/C2 for exactly this |
| **Does the 911 card feel urgent enough** | A judgment call, not an assertion |
| **Photo from a phone camera** | The file picker path differs from a desktop upload |

## Known agent stumbling block

On the 2026-07-31 run the browser agent **could not complete desk sign-in**,
which silently blocked cases B1–B3. If step 6 stalls, sign in yourself first and
hand the already-authenticated tab over. The desk cookie lasts 8 hours.

## Reading the results

Two answers matter more than the rest:

1. **Step 1** — if any fact from the opening message gets re-asked, the headline
   fix didn't land and nothing else is worth reporting to Blake yet.
2. **Step 6a** — the desk photo. Never run against a real blob. "Preview
   unavailable" means the signing path is failing closed as designed; the likely
   cause is the store's random filename suffix containing a character the new
   pathname allow-list rejects. Widen the character class in
   `ATTACHMENT_PATHNAME_RE` — do not remove the check, it is what stops an
   anonymous caller having us presign arbitrary objects.
