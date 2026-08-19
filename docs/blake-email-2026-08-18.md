# Draft email to Blake — 2026-08-18

Rajeev sends this; it is not sent from here. Numbering follows Blake's own
feedback doc so he can match it to his notes. Verification status is from
`docs/e2e-run-2026-08-17.md`.

---

**Subject:** Neuronify — your feedback is in, and it's live

Blake,

Everything you flagged on the 7th is built, tested and deployed to
**neuronify.ai**. Release notes are at **neuronify.ai/changelog** — but here's the
part that matters to you, in your own numbering.

**Your #1 — the opener being thrown away (1.1).** You were right that it was the
most damaging thing in the run, and you were right about why it mattered: being
asked to repeat yourself is the moment a resident gives up. It's fixed. If you
open with *"a big pothole at Fry and Knoxville, in the traffic lane, about the
size of a dinner plate"*, it now takes all four facts from that one sentence and
asks only for what you actually left out. Worth being the first thing you try.

Also addressed:

- **1.2 — the fake "add a photo later" promise.** It no longer offers something
  that doesn't exist. If you say you can't take a photo it asks why, and your
  reason is already filled in when you reach the review screen.
- **1.3 / 4.1 — photos nobody could see.** Both sides now render them. Staff open
  the photo full size from the case; residents see their own on the tracking page.
- **1.5 / 4.4 — no transcript.** The full conversation is now kept on the case,
  next to the change log.
- **4.2 — the desk couldn't see the resolved address.** The case now shows the
  resident's own words with the geocoded address and coordinates beneath them,
  linked to a map. Edit the address on the review screen and the record follows
  the correction rather than keeping the original phrasing's coordinates.
- **4.3 — "Intake Pothole".** Gone everywhere, including the stored workflow title.
- **4.5 — a landmark outranking a later, more specific address.** The newest and
  most specific answer now wins.
- **1.4 — "too fast" after dictating on mobile.** Speech and typing no longer
  share a rate limit. A failed send also no longer eats what you typed.
- **5.5 — the emergency stop you asked for.** Gas, downed power lines, a water
  main break or an injury break off intake immediately with a 911 link. The gas
  one tells you to get clear *before* it tells you to call. Ordinary reports — a
  leaking hydrant, a downed branch, "a tree is down but there are no downed
  wires" — are never interrupted. Both directions are tested; a warning that
  fires on hydrants is worse than none.

**One more, found by my own voice testing after your run — the wrong-corner
problem.** Peoria has two Knoxville/Frye intersections, 5.8 miles apart, and
depending on word order and spelling the map lookup would silently pick one and
never mention the other — a crew could drive to the wrong side of town. Now,
when more than one real spot matches what you said, you get a small map with
lettered pins and the choices are named by what's actually there — "near
Kroger" vs "near McDonald's" — never street names like "N Frye Rd vs E Frye
Ave" that nobody standing at the corner can resolve. Tap the right pin and
that's where the crew goes. Worth trying: report something at "Frye and
Knoxville" and watch it ask.

**Three things I decided not to build, so you know they weren't missed:**

1. **A pre-submit summary (5.1)** — the review screen already is one, and you
   reached it in your run. A second recap would be noise. What it was *missing*
   is now fixed: it prefills the photo reason and shows the resolved address.
2. **A post-filing photo upload link** — this would make the "add it later"
   promise real instead of removing it, but it mutates a filed record and needs a
   permissions model on the reference number. Real work, worth doing, not a
   same-day change. I made the bot honest instead.
3. **3.1, 3.2, 5.3, 5.6–5.9** — third-party routing, SMS, duplicate detection,
   close-the-loop, accessibility, metrics. Product direction rather than defects.
   Each needs a design pass, and I'd rather do them with you than guess.

**Known rough edges, so you meet them here and not in the product:**

- **No emergency phone numbers are configured yet.** The hard stop says "the gas
  utility's emergency line" without a number. Deliberate — I won't invent one —
  but it must be filled in and actually dialled before any pilot.
- **Quick-reply chips can linger after you change the category.** Correct a
  pothole to graffiti and the pothole suggestions may still be on screen. Type
  your answer rather than tapping one. Fix is queued.
- **The description on the case is now your own words when you describe the
  problem up front** — the opening sentence lands on the record as you said it.
  A description pieced together from scattered answers across the conversation
  can still read as a summary; the verbatim transcript is always kept alongside
  it either way.
- **Water reports** land with a city desk rather than being referred out to
  Illinois American.

**To test:**

- Resident side: **neuronify.ai/report/chat** — no login.
- City side: **neuronify.ai/desk**, passcode `public_works-2026` (noise
  complaints land in Police: `police-2026`).
- Find-your-report: file something, then open **neuronify.ai/track** with no id.

**Four decisions I need from you — a couple are holding things up:**

1. **Photo policy — this one is load-bearing.** Eight categories currently refuse
   to file without either a photo or a stated reason. That's live right now and
   nobody outside the build has approved it. If you want it softer it's a
   one-line change. Please give me a view before this goes near a resident.
2. **Roughly 22 report categories — is that the right granularity**, or should it
   be a shorter list?
3. **The Peoria department map** — particularly water going out to a private
   utility, and rats going to Code Enforcement.
4. **Keep the `other_inquiry` catch-all?**

The whole thing has been through a full end-to-end pass in the browser — the
photo, the address the crew would actually drive to, the transcript, the
emergency stop — so what you're testing should hold together rather than fall
over on the first click.

Thanks for the run-through on the 7th. It was the most useful hour this project
has had.

Rajeev
