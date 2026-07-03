# Design Brief — Neuronify v2 (Civic Engine)

**Date:** 2026-07-02
**Author:** Rajeev Kumar (with Claude grill-me)
**Status:** Draft · pre-implementation

## One-line scope
Rebuild Neuronify around Blake's Civic Engine design: a voice-first citizen drop that an
agent digests, categorizes, and routes into a **dynamic, per-issue workflow** laid out as a
Simulink-like approval graph — automating the city's existing bureaucratic manual process,
with an append-only audit spine.

## Why this, why now
v1 was a best-guess sketch built without deliberately modeling the process. Blake (City of
Peoria) laid out a more considered design — mic-first entry, an agent that *shows its work*,
and a visual workflow graph where the process for an issue is composed rather than pulled off
a fixed shelf. Rajeev is adopting Blake's model as the target. The near-term goal is not
co-governance or a public launch; it is to **prove the whole pipeline works end-to-end** —
transcription → routing → department mapping → database — and build confidence to expand.

## Who it's for
- **Primary (v1):** the operator/demo driver (Rajeev + collaborators at Distillery Labs),
  proving the loop on realistic Peoria data.
- **Modeled but not yet live:** residents (voice submitters) and city department staff
  (approvers). Roles are played during the demo, not wired to real city staff.

## Core thesis
The workflow is a **dynamic entity, not a fixed one.** For each issue the agent *composes*
a bespoke path from a vetted palette of step primitives. To keep this auditable, the graph is
**composed dynamically at intake, then frozen per instance** — once launched, that issue's
graph is immutable and every action appends to a ledger. Dynamic at authoring, frozen at
instantiation. **Co-governance is a deferred sub-feature, not the core** — the core is
automating today's manual bureaucratic process; the actor model just keeps the door open.

## In scope (v1)
- **Mic-first citizen drop** (already exists) → voice captured.
- **Auditable digestion pipeline:** transcribe → extract/fill form → classify
  (category + severity + department) → propose a workflow graph *from the vetted primitive
  palette only*. Each stage inspectable and correctable.
- **Staff confirmation gate:** agent proposes the full graph + severity + routing; a staffer
  reviews on the Simulink canvas (viewer + light edit — swap a department, add/remove an
  approval, fix severity) and one-click approves before it goes live. An accountable human
  launches it.
- **Dynamic workflow engine:** agent-composed graph, frozen per instance. Step primitives:
  `Intake`, `Departmental Approval` (parallel AND-gate, portion-scoped — salvaged from v1),
  `Notify`, `Condition/branch`. Payment/inspection are typed Approval variants for now.
- **Departmental action:** each department gets an SMS/email nudge that deep-links into an
  authenticated desk queue; approve / deny / request-resubmit there, every action signed.
- **Resident status + relay:** simplified status rail (Submitted → Under review → Scheduled →
  Resolved). SMS-first relay (email fallback) on v1's cadence: receipt · each whole step-close ·
  immediate on resubmit-ask · terminal. Not one per department.
- **Append-only event ledger** in Postgres (Neon); live state is a projection (fold) over
  events; frozen graph stored as JSON on the instance.
- **Flagship scenario A — Pothole / road hazard** (single department, clean happy path) built
  end-to-end first; **B — permit with a branch** ("if historic district") as the fast-follow
  that shows the Simulink fork.

## Out of scope (explicitly)
- **Co-governance / resident-as-participant** — data model supports it (role-not-side), no UI. *Deferred; not the core of v1.*
- **Power-user full-graph resident view** — residents get the simplified rail. *Progressive disclosure, later; a city of engineers will want the depth eventually.*
- **Full drag-drop staff builder / template authoring** — canvas is viewer + light-edit at the gate. *Authoring is a later tool; the agent composes for now.*
- **Real department integration / production SMS to real city staff** — demo roles instead. *Real integration needs city buy-in not yet in hand.*
- **Payment as a first-class step type** — modeled as a typed Approval. *Not needed to prove the pipeline.*
- **City / county multi-tenant layers** — Peoria-only, single tenant. *Grassroots first; layer later.*
- **Attachments on workflow nodes** (photo/document evidence riding specific steps of the trail) —
  *2026-07-02 field-test idea (Rajeev). The engine is pre-shaped for it (`requiresAttachments`
  on steps, attachment fields); needs real blob storage, so it's the designed next step after
  the demo, not a rush job.*

## How it works (happy path — Pothole, scenario A)
1. Resident opens Neuronify, taps the mic, describes a pothole at "Main St & 5th."
2. Pipeline runs: transcribe → fill the pothole form → classify (Roads / severity / Public
   Works) → propose a graph (Intake → Public Works Approval → Notify → Done).
3. Resident sees the filled form + chosen severity/category (correctable) and a confirmation.
4. Staffer sees the composed graph on the canvas, tweaks if needed, approves. Graph freezes.
5. `workflow.opened` + `step.opened` events append; Public Works gets an SMS deep-linking to
   the desk; they approve their portion. Step closes.
6. Resident gets the step-close SMS; on resolution, the terminal SMS. Every action is in the
   ledger.

## Failure modes & graceful behavior
| When | What the user sees | What the system does |
|---|---|---|
| Transcription garbles the location | Resident sees the extracted address, can correct it before submit | Form field flagged low-confidence; never auto-launches on a bad address |
| Agent mis-classifies dept/severity | Staffer catches it at the confirm gate | Staff edit overrides; the edit is itself an audited event |
| Agent proposes an invalid graph | Staff reject or edit at the gate | Composition constrained to the vetted primitive palette; can't invent step types |
| New facts emerge mid-flight (needs another agency) | — | Graph is frozen; spawn a *new linked issue* or amendment event — original path never mutates |
| Department requests a re-submit | Resident gets an immediate SMS with the specific portion to redo | Only that portion loops; other approvals stay locked; step doesn't advance until it returns |

## Data & state
- **Append-only event ledger** (Postgres/Neon) is the source of truth; nothing is rewritten.
- **Live workflow state = a fold/projection over events.** Frozen graph persisted as JSON on
  the instance at launch.
- **Actor model: role, not side.** An actor has a role per step (submitter, department-approver,
  and — later — resident-collaborator, external-agency). Each action still tags external/internal
  for the timing clock. Same person can be submitter on one issue, collaborator on another.

## Integrations & dependencies
- **Claude** (latest models) for the digestion pipeline — extraction, classification, and
  palette-constrained graph proposal via structured output/tool-use. Prefer a staged pipeline
  over one mega-prompt so each step is inspectable.
- **Voice → text** speech-to-text for the mic drop.
- **Postgres (Neon)** for the event ledger + projections.
- **SMS provider** (email fallback) for resident relay + department nudges.
- **Salvaged from existing `engine/`:** append-only audit ledger + portion-scoped departmental
  approval logic. Discard the fixed sequential runner and the v1 UI.

## Constraints
- Every state-changing action must be **authenticated and audited** (no act-by-email shortcuts).
- Composition must be **defensible** — LLM may only assemble from the vetted primitive palette,
  and a human confirms before launch.
- Single-tenant (Peoria), demo-grade hardening; not yet public-facing.

## Open questions / deferred decisions
- Exact DAG execution semantics with branches (how a `Condition` node evaluates, and how
  parallel branches rejoin) — settle when building scenario B.
- Whether "amendment" (new facts mid-flight) is a linked-issue or an in-instance appended event —
  defaulting to linked-issue; revisit if it feels heavy.
- STT provider choice and address-normalization approach — decide at build.
- Read-performance (snapshots over the ledger) — not needed at pilot scale; revisit later.

## Risks
- **Transcription/classification errors erode demo trust** — mitigated by the correctable form
  + staff gate; pick a clean flagship (pothole) first.
- **Salvaging v1 engine code drags in fixed-sequential assumptions** — treat branching/DAG as a
  new layer; keep only the ledger + approval primitives.
- **Scope creep toward co-governance / builder** — explicitly banked; hold the cut line until
  the pipeline is proven end-to-end.
- **Agent-composed graphs feel unpredictable** — palette constraint + human confirm gate are the
  guardrails; if it still feels loose, tighten toward rule-guided composition later.

## Rollout sketch
End-to-end **demo on realistic Peoria data**, driven at the Distillery Labs / Vibe Coding
sessions with collaborators playing resident + department roles. Build **scenario A (pothole)**
through the full loop first — voice → digest → staff-confirm → frozen graph → departmental
approval → resident SMS → resolved, all in the ledger — then add **scenario B (permit with a
branch)** to show the Simulink fork. No real city commitment required to prove the thesis;
real-department pilot and public beta are later stages.

## Decisions log (the grilling)
- **Q1 — Where does an issue's workflow come from?** **A:** Agent-composed at intake from reusable primitives. *(why: only option that delivers the bespoke/transparent/shows-its-work thesis.)*
- **Q2 — Can a live graph change mid-flight?** **A:** Frozen, period; new facts spawn a linked issue/amendment. *(why: cleanest audit story — a city points to one fixed record.)*
- **Q3 — How do we model who can act?** **A:** Role, not side. *(why: flexible enough for future co-governance, keeps the timing model.)*
- **Q4 — Human gate before a path goes live?** **A:** Staff confirms composition. *(why: keeps the accountable human who's currently liable; enables palette-constrained LLM composition.)*
- **Q5 — Step primitive palette?** **A:** Lean core — Intake, Departmental Approval, Notify, Condition/branch. *(why: smallest set that models real bureaucracy while keeping the branch.)*
- **Q6 — What does the resident see?** **A:** Split like Blake — filled form + severity, then a simplified status rail. *(why: full DAG would overwhelm; the rail is the transparency they need.)* *(future: pro/full-graph view for power users.)*
- **Q7 — How does a department act?** **A:** In-app authenticated desk + notification nudge. *(why: meets low-tech staff via notification but keeps actions signed/audited.)*
- **Q8 — Resident relay cadence + channel?** **A:** v1 cadence (receipt / step-close / immediate resubmit / terminal), SMS-first. *(why: the cadence was well-designed; SMS matches voice-first entry.)*
- **Q9 — Persistence model?** **A:** Append-only event ledger; state as a projection; frozen graph as JSON. *(why: audit-native; extends v1's one good idea to a DAG.)*
- **Q10 — Build approach?** **A:** Salvage `engine/`'s ledger + portion-scoped approvals; replace the rest. *(why: don't rewrite working audit code from zero.)*
- **Q11 — Simulink canvas: builder or viewer?** **A:** Viewer + light edit at the gate. *(why: matches agent-composed/staff-confirms; full authoring is a later tool.)*
- **Q12 — One agent call or a pipeline?** **A:** Auditable pipeline, palette-constrained composition. *(why: transparency needs each stage visible; constraint keeps it defensible.)*
- **Q13 — What is v1 for?** **A:** End-to-end demo on realistic Peoria data; roles played, not wired to real staff. *(why: matches building live in the open; real integration needs buy-in.)*
- **Q14 — Cut line confirmed?** **A:** Yes — bank co-governance, power-user view, full builder, real dept integration, payment step, multi-tenant. *(why: prove the pipeline first, then build on it.)*
- **Q15 — Flagship scenario?** **A:** Pothole (A) end-to-end first, then permit-with-branch (B). *(why: lowest complexity proves the spine; the branch shows the loved Simulink fork.)*
