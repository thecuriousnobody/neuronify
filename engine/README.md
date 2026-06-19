# Neuronify Engine

The framework-agnostic core of Neuronify v2: the conversational-intake + workflow
engine described in the founding sketch.

## The one rule

**`app/` may import `engine/`. `engine/` must NEVER import from `app/`, `lib/`, or
any Next.js / React / Node-server API.**

Everything in here is pure TypeScript over plain data. Anything the engine needs from
the outside world — a database, a clock, an LLM, a way to send a message — it asks for
through a **port** (an interface in `ports.ts`). The Next.js app supplies the concrete
**adapters** that implement those ports. That inversion is what keeps the engine:

- **testable** — swap in in-memory / fake-clock adapters and the whole state machine
  runs in a unit test with no DB and no network;
- **spin-off-able** — the day we lift the engine into its own package or service, it
  moves as-is; only the adapters change.

If you find yourself reaching for `next/*`, `process.env`, `fetch`, `Date.now()`, or a
SQL client inside `engine/`, stop — that belongs behind a port.

## The model (maps 1:1 to the sketch)

**Citizen side** — `VOICE → FORM FIELDS → HUMAN-IN-THE-LOOP VERIFIED & SUBMITTED → WORKFLOW`
- A `FormDefinition` is a set of `FormField`s. The intake conversation's only job is to
  fill those fields (asking clarifying questions until required fields are present).
- At human verify-and-submit, a `Submission` is created. **That is the moment the
  Record of Truth / audit trail begins** — see `audit`.

**City side** — "the workflow is always TRACKING and RELAYING, never DOING the work."
- A `WorkflowDefinition` is a set of `WorkflowStep`s. Each step governs a **slice** of
  the submission (`scope`) and is decided by one or more `approvers`.
- A step resolves to `approved` / `denied` / `requires_resubmit`.
- **Portion-scoped approvals, captured once:** a `requires_resubmit` targets only its
  slice. Approved slices lock and never re-run. (sketch: parallel approvals + loop)
- Every outcome emits a `CommunicationIntent` back to the submitter (relay).

**The spine** — `audit` is an **append-only** event log. A re-submit never rewrites
history; it appends. `timing` derives external (citizen) vs internal (city) step times
purely from that log — which is why every event records which side acted.

## Layout

```
engine/
  domain/      # the vocabulary: types only, no behavior
  ports.ts     # interfaces the app must implement (Clock, Repository, Notifier, LLM)
  workflow/    # the state machine (Phase 1) — pure reducers over events
  audit/       # append-only ledger helpers (Phase 1)
  timing/      # external/internal step-time derivation (Phase 1)
  intake/      # conversational form-filling (Phase 3)
  index.ts     # the public surface the app is allowed to import
```
