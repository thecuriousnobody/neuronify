# Smart Intake — Conversational `/report/chat` Test Plan

**Route under test:** `/report/chat` — the new anonymous, category-first conversation.
**Runner:** Claude-in-Chrome (browser agent) or a human, by typing.
**Last verified by Claude:** see the Results table at the bottom.

---

## Prerequisites

1. **A working LLM model.** The engine default `qwen/qwen3-32b` is stale on Groq (returns 404 — the key is valid, the model name isn't). For local runs, add one line to `.env.local`:
   ```
   AGENT_INTAKE_MODEL=llama-3.3-70b-versatile
   ```
   then `npm run dev` and open `http://localhost:3000/report/chat`. (Or test on a deployment where the model is configured.)
2. **No login required** — this is the anonymous path.
3. **Pacing.** The endpoint is rate-limited per IP. Let each agent reply land before sending the next message; firing two sends within ~1s can return `"Too fast — give it a second."` (that's the limiter, not a bug).
4. **Typing, not mic.** The 🎙 button uses Chrome's Web Speech API; for automated runs, **type** into the composer — it's the reliable path.

## What "pass" looks like at a glance

- Once the agent identifies the issue, the header badge reads **`<Category> · routed to <Department>`**.
- The agent asks **one plain-language question at a time**.
- **Category-specific** questions appear (pothole size; tree public-vs-private; etc.).
- On completion: an **"I've got what I need"** card → **Review & finish** → an editable review → **Finish** → a **summary** listing all fields + the routing.

## Out of scope (do NOT test — not wired yet, by design)

- **Final submission / persistence.** The flow ends at the summary on purpose.
- **Photo upload** — shows "coming soon"; finish without it.
- The old `/report` and `/intake` routes (unchanged).

---

## Test cases

> For each: perform the steps, then check the expected result. Record pass/fail in the Results table.

### TC1 — Vague input stays in triage (no premature lock)
- **Type:** `something is wrong outside my house`
- **Expect:** the agent asks a clarifying question; **no category badge** appears yet (header still shows "Peoria, IL").

### TC2 — Pothole → Public Works, with the size question
- **Type:** `there's a big pothole on Knoxville Ave taking up the whole lane and cars are swerving`
- **Expect:** badge **"Pothole · routed to Public Works"**; agent asks for a specific detail (e.g., cross-street).
- **Then type:** `it's near the school, it's large — bigger than a car tire — and yes it's a hazard`
- **Expect:** at review, `size = large` and `hazard = Yes` were captured.

### TC3 — Graffiti → Police
- **Type:** `graffiti sprayed all over the underpass wall on Adams St`
- **Expect:** badge **"Graffiti · routed to Police"**.

### TC4 — Tree issue → Public Works, with the public-vs-private question
- **Type:** `a big tree limb fell and is blocking the sidewalk on Elm St`
- **Expect:** badge **"Tree Issue · routed to Public Works"**; the agent asks whether the tree is on a parkway/park or on private property.

### TC5 — Peoria divergence: rodents → Code Enforcement
- **Type:** `there are rats in the alley behind my house`
- **Expect:** badge **"Rodent Pest · routed to Code Enforcement"** (Peoria routes rats to Code Enforcement — this is the intended, non-obvious mapping).

### TC6 — Water → route-out (private utility)
- **Type:** `there's a water main break flooding the street on Main St`
- **Expect:** badge **"Water Sewer · routed to Water External"** (Peoria's water is Illinois American Water, a private utility — the canonical owner is external, not a city desk).

### TC7 — Catch-all
- **Type:** `who is my alderman and when is the next council meeting?`
- **Expect:** badge **"Other Inquiry · routed to Clerk"**; no location is demanded.

### TC8 — Full completion → review → summary
- Run TC2 and keep answering the agent's questions until it says **"I've got what I need."**
- Click **Review & finish** → confirm the review form lists the collected values → click **Finish**.
- **Expect:** a **summary** showing every field + **"routed to Public Works"** + a note that submission is the next step to wire.

### TC9 — Edits persist to the summary
- In the review step (from TC8), change a value (e.g., set size to `medium`), then **Finish**.
- **Expect:** the summary reflects the edited value.

### TC10 — Robustness
- **Empty composer:** the **Send** button is disabled.
- **Rapid double-send:** may show `"Too fast — give it a second."` — expected (rate limiter).

---

## Results

| TC | What | Pass/Fail | Notes |
|----|------|-----------|-------|
| TC1 | Vague → triage | | |
| TC2 | Pothole → Public Works + size | | |
| TC3 | Graffiti → Police | | |
| TC4 | Tree → public/private question | | |
| TC5 | Rodents → Code Enforcement | | |
| TC6 | Water → route-out | | |
| TC7 | Catch-all → Clerk | | |
| TC8 | Completion → summary | | |
| TC9 | Edit persists | | |
| TC10 | Robustness | | |
