# Intake transcript retention

**Decision (2026-08-07): retain by default.** Every report filed through
`/report/chat` preserves its conversation into the case ledger.

## Why this is not purely a product call

Blake's testing review raised this as a records question rather than a feature
question, and that framing is the right one:

> Many states treat citizen communications with a municipality as public records
> with a retention schedule attached. If a resident reports a safety hazard and
> someone is later hurt there, the transcript is the evidence of what the city
> was told and when.

Two consequences follow.

**It is easier to defend keeping than to explain deleting.** A city that
discards resident communications has to justify that choice against its own
records schedule. A city that keeps them has to justify nothing.

**The distilled fields are not a substitute.** The form captures what the intake
assistant understood. The transcript captures what the resident actually said —
including the things the assistant did not have a field for. When those two
disagree, the transcript is the record that matters.

## How it is stored

As an append-only `intake.recorded` event on the case, alongside the channel it
arrived on. It is not a mutable column: the ledger is the audit trail, and a
transcript that could be edited after the fact would be worthless as evidence.

An empty conversation records **no event at all**. "No transcript" and "a
transcript that says nothing" are different facts about a case, and the desk
distinguishes them.

Bounds, enforced at `/api/v2/submit-anon`: the last 60 turns, 4,000 characters
per turn, 20,000 characters total. The text is composed server-side from
structured turns rather than accepted as a client-supplied blob, so a caller
cannot dress arbitrary text up as the resident's words.

## What still needs a human decision

These are policy, not code, and they belong to the city rather than to us:

- **A retention period.** Nothing expires today. Whatever the city's schedule
  says for citizen communications should be applied here, and doing so needs a
  deletion path that leaves the audit trail coherent — the ledger is
  append-only, so removing a transcript means recording that it was removed.
- **Who may read it.** Any signed-in desk can currently open any case's
  transcript. That is the same scope the case detail already had, but a
  transcript is more personal than a form, and per-department confinement is
  worth revisiting before a pilot.
- **What residents are told.** They are not currently told the conversation is
  kept. If it is a public record, saying so plainly at the start of the chat is
  both honest and, in some states, required.
