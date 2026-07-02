# Build Plan — Neuronify v2, Scenario A (Pothole, end-to-end)

**Date:** 2026-07-02
**Source design:** `docs/grill/grill-2026-07-02-neuronify-v2-civic-engine.md`
**Goal:** prove the whole pipeline end-to-end on one clean scenario —
voice → digest → staff-confirm → frozen graph → departmental approval →
resident SMS → resolved, every action in the append-only ledger.

## Salvage assessment (what the existing `engine/` already gives us)
The current engine is a strong foundation, not a throwaway. **Keep as-is:**
- Ports/adapters boundary (`Clock`, `IdGenerator`, `Repository`, `Notifier`, `LLM`) — engine
  stays framework-agnostic; app wires Neon / system clock / lib/ai / notifier.
- **Append-only ledger as the source of truth**; state is `deriveInstance(events)` (a fold).
- Pure command pattern: load log → derive → run pure command → append events + relay comms.
- Portion-scoped departmental approvals + resubmit loops.
- External/internal timing (`computeTiming`), desk queue/detail, metrics.
- Voice→form intake conversation (`runIntakeTurn`).

**What actually changes for v2 (the real work):**
1. **Graph replaces the linear definition.** Today a `WorkflowDefinition` is `steps[]` executed
   in strict array order. v2 needs a **DAG** (nodes + edges) with a `Condition` primitive.
2. **Freeze-per-instance via the ledger.** Instead of fetching a pre-authored
   `WorkflowDefinition` by key, the **composed graph is stored in the `workflow.opened` event
   payload** — so the frozen graph lives in the audit log itself (no separate def table, and it's
   immutable by construction). `deriveInstance` reads the graph from that event.
3. **Sequential open-logic → DAG open-logic.** `freshSteps`/step-advance becomes graph traversal:
   a node opens when all its predecessors have closed; `Condition` selects which edge to follow.
   *(Scenario A has no Condition — a linear 3-node graph — so this can land minimally for A and
   grow for B.)*
4. **New: composition pipeline + staff confirm gate + canvas** (all net-new, below).

---

## Milestones (ordered by dependency)

### M1 — Engine: graph model + frozen-instance derivation
- Add a `WorkflowGraph` type: `nodes[]` (each a palette primitive: `Intake` | `Approval` |
  `Notify` | `Condition` | `Start`/`Done`) + `edges[]` (with optional condition label).
- Store the composed graph in the `workflow.opened` event payload; extend `deriveInstance` to
  read the graph from the log instead of a `WorkflowDefinition` arg.
- DAG open-logic: node opens when predecessors closed; keep portion-scoped `Approval` semantics
  unchanged. (Scenario A = `Start → Intake → Approval(public_works) → Notify → Done`, linear.)
- Keep all existing command/event types; add only what the graph needs.
- **Done when:** unit tests fold a hand-authored pothole graph through open → approve → close →
  complete, entirely from events (extend the existing `engine/workflow/*.test.ts`).

### M2 — Persistence: Neon schema + Repository adapter
- Tables: `submissions` (Record of Truth), `audit_events` (append-only ledger),
  `form_definitions` (authored — seed the pothole form). No `workflow_instances` table — the
  instance is derived; the frozen graph rides in the ledger.
- Implement the `Repository` port against Neon; wire `Clock`/`IdGenerator`/`Notifier`/`LLM`
  adapters in the app.
- **Done when:** an integration test (real Neon, per hardening rule — not mocks) round-trips a
  submission + its events and re-derives identical state.

### M3 — Digestion pipeline (the agent, auditable stages)
- Stage 1 **transcribe** (STT provider — pick one, wrap behind a small port; swappable).
- Stage 2 **fill**: Claude fills the pothole form fields from the transcript (structured output).
- Stage 3 **classify**: category + severity + department.
- Stage 4 **compose**: propose a `WorkflowGraph` **from the vetted palette only** (for A, a
  deterministic single-department assembly; the LLM's freedom is constrained to the palette).
- Each stage returns an inspectable object; nothing launches yet.
- **Done when:** a recorded pothole transcript produces a filled form + classification +
  proposed graph, each stage individually viewable.

### M4 — Staff confirm gate + canvas (viewer + light edit)
- Staff route (evolve `/desk`): render the proposed graph on a canvas (nodes + edges), the filled
  form, severity/department.
- Light edit: swap department, adjust severity, add/remove an `Approval`. No blank-canvas author.
- **Approve** → create the `Submission`, emit `submission.created` + `workflow.opened` (with the
  **frozen graph** in payload) + open the first node. This is the accountable-human launch.
- **Done when:** approving on the canvas launches a live instance whose graph matches what was
  shown, and the ledger shows the launch events.

### M5 — Department desk (authenticated action)
- Evolve `/desk` queue: list open approvals for a department; actions approve / deny(reason) /
  request-resubmit(portion) → each appends an event; node closes when all approvals approved.
- Notification nudge: `Notifier` sends an SMS/email deep-link to the desk. (Demo: real SMS if a
  provider's wired, else a logged/console stub — swappable.)
- **Done when:** a department approves its portion from the desk and the graph advances, all audited.

### M6 — Resident status + relay
- Evolve `/track`: simplified status rail (Submitted → Under review → Scheduled → Resolved),
  derived from instance state.
- Relay on v1's cadence (receipt / step-close / immediate resubmit / terminal), **SMS-first**,
  email fallback, via the `Notifier`.
- **Done when:** a resident sees live status and receives the cadence messages through the loop.

### M7 — Wire the pothole path + demo polish
- Seed the pothole `form_definition`; realistic Peoria addresses/data.
- Full loop dry-run: `/speak` (mic) → digest → staff-confirm → desk approve → resident SMS →
  resolved — with collaborators playing resident + department roles at Distillery Labs.
- **Done when:** the whole pipeline runs start to finish on realistic data, reproducibly.

---

## Sequencing notes
- **M1 → M2 are the foundation** (engine graph + persistence); everything sits on them. This is
  where I start.
- M3 (agent) can develop in parallel against M1's types once the graph shape is fixed.
- M4–M6 are the three surfaces; M7 is the integration/demo pass.
- **Scenario B (permit + branch)** reuses all of this and only exercises the `Condition` node +
  multi-department parallel approvals — the DAG open-logic from M1 is built to grow into it.

## Guardrails carried from the design
- Every state-changing action authenticated + audited; no act-by-email.
- LLM composition constrained to the vetted palette; human confirms before launch.
- Graph frozen at launch; new mid-flight facts → a linked issue, never a mutation.
- Integration tests hit real Neon, not mocks (hardening rule).
