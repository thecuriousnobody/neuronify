# Neuronify v2 — Demo & Test Guide

**For:** Blake (City of Peoria) and demo collaborators
**Live:** https://neuronify.ai — `/report` is the resident door; `/desk` is the
staff sign-in (department passcodes shared privately, never in this repo).
**What this is:** Scenario A of the Civic Engine design, built end-to-end and working.
A resident *speaks* a problem; an agent digests it — fills the form, classifies
severity, routes it to the right department — and shows its work at every step;
a human staffer confirms before anything launches; the workflow runs as a frozen,
fully audited graph; the resident tracks every decision and gets text updates.

Built from Blake's Civic Engine prototype (the Synapse re-skin handoff), on the
design decisions in `docs/grill/grill-2026-07-02-neuronify-v2-civic-engine.md`.

---

## The cast (four surfaces, three roles)

| Surface | Who | What happens there |
|---|---|---|
| **`/report`** | Any resident (anonymous, no login) | Tap the mic, describe the problem. The agent reads back **what it understood** — category, severity, routed department, each extracted field, an approximate map pin — with tap-chips to fill anything it missed. Optional phone number for text updates. |
| **`/track/<id>`** | That resident | Their private tracker: the record they filed, each review step's status, and the time-with-city vs. time-awaiting-you split. The link arrives by text. |
| **`/desk/intake`** | The **front desk** (clerk) | All incoming drops queue here. Review one → the agent's digestion appears beside a **composed workflow canvas** (click steps to inspect, attach staff notes, add/remove review steps, thumbs-vote the composition). Check the due-diligence box → **Confirm & Launch** — the accountable-human gate. |
| **`/desk`** | **One department's queue** | Only what's waiting on *your* department's signature. Approve / request re-submit / deny (with reason). The passcode decides which department you are — same URL, different inbox. |

**Key ideas under the hood**
- The workflow is **composed per report** by the agent (from a vetted step palette),
  then **frozen at launch** into an append-only audit ledger. Nothing is ever
  rewritten; state is always re-derived from the event log.
- The launch records **who** confirmed it (`launchedBy`) and any **staff notes**
  — both frozen into the permanent record.
- Every decision relays to the resident on a calm cadence (received → step
  complete → outcome; a redo-request goes out immediately). With Twilio keys these
  are real SMS; without, the dev log shows exactly what would send (`[relay:…]`).
- Departments get an action nudge the moment work lands on them.

## Setup (once)

```
npm install
npm run engine:db:setup     # Neon schema (idempotent)
npm run engine:seed         # pothole form definition
npm run demo:seed           # optional: paints queues with demo data
npm run dev                 # localhost:3000
```

`.env.local` needs: `DATABASE_URL`, `GROQ_API_KEY` (or other LLM),
`DEEPGRAM_API_KEY` (mic), `DESK_PASSCODES` (e.g.
`clerk:clerk-dev,public_works:pw-dev,water:water-dev,parks:parks-dev,code_enforcement:code-dev`).
Optional: `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM` + `DESK_CONTACTS` for real SMS,
`APP_BASE_URL` for links in messages.

## The rigorous end-to-end script

**Test 1 — happy path, same department (≈5 min)**
1. `/report` → mic (or type): a pothole **with a real intersection** ("…at Knoxville
   Avenue and Giles Lane…") and say it's dangerous → *See what we understood*.
2. Verify the card: severity chip · "routed to Public Works" · your intersection
   with the **◎ ≈ normalized address + map link**. Click the map — right corner?
3. Enter a real cell number → *Send* → verify the official record card + the
   **Received timestamp and Ref**.
4. `/desk` → passcode `pw-dev` → **Front desk** (`/desk/intake`): your report is in
   *Waiting for review* → **Review** (auto-digests).
5. Canvas: click the Public Works step → type a staff note → *+ Add review step*
   (add Water, then remove it) → thumbs-vote the composition.
6. Check the due-diligence box → **Confirm & Launch** → verify the **Launch
   Record** (reference · timestamp · launched-by · route).
7. `/desk` (department queue): open the report → verify you see the record and
   *your portion to sign off* → **Approve**.
8. Open the **Track** link → verify *Complete*, the original report content, and
   the timing split. Dev log (`/tmp/neuronify-dev.log` or terminal) shows the
   `[relay:submitter→<your number>]` receipt + completion lines.

**Test 2 — cross-department routing (the good one)**
9. `/report`: describe a **water leak** at an intersection → send.
10. Front desk → Review → verify the agent routed it to **Water** → Launch.
11. `/desk` as Public Works: queue is **empty** — correct! Least-privilege:
    PW cannot see Water's work.
12. Sign out → sign in `water-dev` → the leak is waiting → Approve → tracker
    completes. One URL, identity decides the inbox.

**Test 3 — the deny path**
13. `/report`: something the city should refuse ("my neighbor's fence is ugly,
    corner of Main & Sheridan") → send → front desk → Launch.
14. Department queue → **Deny** with a reason → tracker shows *Not approved* with
    the step declined; the reason is relayed to the resident.

**Also verify (60 seconds)**
- `/speak` and `/intake` redirect to `/report` (old doors retired).
- A vague report ("my street is dark") → location flagged *"we didn't catch
  this"* with an inline add-field, and hazard chips **[Yes][No]** when unstated.
- Speak a correction after the card shows ("no — actually it's at Fulton and
  Southwest Washington") → the card re-digests; the **latest statement wins**.

## What's deliberately NOT here yet (the next chapters)

- **Scenario B — the branch.** Conditions ("if historic district"), parallel
  multi-department sign-offs in one step, branch/rejoin on the canvas. The engine
  already executes parallel approval gates (tested); the composer and canvas grow
  next. *This is where Blake's input on branch semantics shapes the build.*
- **Form library.** One form type is seeded (pothole), so every report wears the
  "Pothole Report" label for now. The template library from the design (streetlight,
  sidewalk, permits…) is the fix.
- **ERP handoff.** Today the department queue is the department's workbench. The
  designed seam: an adapter pushes launched work into the department's real system
  (Cityworks/Lucity/…) and syncs status back into the audit trail. The engine's
  ports architecture was built for this.
- **Attachments on workflow steps** (photo/document evidence riding the trail),
  resident re-submit UI for anonymous reports, canvas zoom, city/county layers.

## Known honest limitations

- Anonymous residents' only key to their tracker is the texted link (no account,
  no list page — by design, for privacy).
- The geocoder (free US Census service) resolves streets/intersections, not
  landmarks — "next to the Caterpillar Museum" honestly shows *couldn't pin this*
  and asks for a cross-street. A city parcel/GIS layer can replace it behind the
  same seam.
- Classification severity/category currently informs routing and display but the
  workflow record persists the *routing outcome* (the graph), not the label —
  planned to ride the frozen payload in the next round.

---
*Repo docs: design brief + build plan in `docs/grill/`. All engine behavior is
unit-tested (30 tests) plus two live-database integration smokes
(`npm run engine:smoke`, `npm run engine:smoke:graph`).*
