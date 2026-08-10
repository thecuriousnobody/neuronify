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

## What residents are told (done 2026-08-10)

They are told, before they speak, on both front doors:

> Your conversation is saved with your report and can be read by city staff. It
> may form part of the public record, so please leave out anything you wouldn't
> want kept on file.

It appears in the opening hero — ahead of the first word, not after it — and
again above **Finish**, because the review screen reads back the *fields* and so
quietly implies the fields are all that gets filed. The old voice-only `/report`
carries it too: unlinked and slated for retirement, but still reachable, and the
door where people speak rather than type.

`lib/retention-notice.test.ts` guards the class — any page posting to an intake
API that retains words must render the notice, and the notice must state both
facts (that it is kept, and who can read it). Retention alone is not a
disclosure.

The wording deliberately says *may* form part of the public record. Many states
treat citizen communications this way; asserting that Illinois does, in the
resident's face, is a legal claim this repo has not verified.

## What still needs a human decision

These are policy, not code, and they belong to the city rather than to us:

- **A retention period.** Nothing expires today. Whatever the city's schedule
  says for citizen communications should be applied here, and doing so needs a
  deletion path that leaves the audit trail coherent — the ledger is
  append-only, so removing a transcript means recording that it was removed.
  **Build the mechanism only once there is a number** — a deletion path with no
  schedule behind it is a guess with a cron job attached.
- **Who may read it.** Any signed-in desk can currently open any case's
  transcript. That is the same scope the case detail already had, but a
  transcript is more personal than a form, and per-department confinement is
  worth revisiting before a pilot.
- **Scrubbing is NOT on this list, and that is deliberate.** Stripping names and
  numbers out of the transcript directly contradicts the reason for keeping it:
  it is evidence of what the city was told. Redacting the record damages the
  thing the record is for. If a redaction need is real, it belongs to the
  records officer as a per-case action with an audit entry — not to an
  automatic filter nobody can inspect after the fact.
