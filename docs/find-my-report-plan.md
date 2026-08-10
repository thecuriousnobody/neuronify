# Finding your report again

**Decision 2026-08-10 (Rajeev).** Build the device-side fix. Defer
subscribe-to-updates.

## The problem, as found

Rajeev filed a report during the manual verification run, lost the reference
number, and had no way back to it. Going to `/track` without an id is a 404.

The done screen today renders this, as plain text:

> Your reference number is `f08b0bcf-aa1f-4dff-a99d-2daf7379e8e9` — keep it to
> check on this report.

Not a link. Not copyable. There is no `localStorage` anywhere in the app. The
resident is being asked to hand-transcribe 36 characters of hex, and nobody
will.

Root cause is structural, not cosmetic: **the intake is anonymous by design, so
the city has no way to reach the resident.** That forces the only handle on the
report onto the resident's side. A UUID is the worst available handle.

## What to build

### 1. The device remembers

On a successful filing, append to a `localStorage` list. Minimal fields only —
this sits unencrypted on a possibly-shared device, so it records what the report
*was*, never what was *said*:

```
{ id, category, department, filedAt, matched? }
```

- **No description, no transcript, no photo, no address the resident typed.**
  `matched` (the geocoded address) is a public street corner and is fine.
- Cap the list (~20), newest first.
- Every read and write wrapped — private mode and disabled storage must fail
  soft and silently, never throw into the filing path. **A storage failure must
  never cost someone their report.**

### 2. `/track` becomes an index

New `app/track/page.tsx` (client). Lists reports from this device, each linking
to the existing `/track/[submissionId]`. Empty state explains it only knows
about reports filed from this browser.

Include a **"Forget these"** control. Someone filing from a library computer or
a shared phone needs a way to clear the list, and a device-memory feature
without an eraser is a privacy problem we authored ourselves.

### 3. The done screen offers a real handle

- A tappable **Track this report** link to `/track/<id>`.
- One-tap **Copy** of the full URL, with a copied-confirmation.
- Keep the raw number visible but demote it — it is the fallback, not the
  interface.
- Consider `navigator.share` where supported, so they can text the link to
  themselves without us collecting a phone number. Progressive enhancement only.

## Explicitly NOT in this build

**Subscribe-to-updates (email/SMS).** Rajeev raised it and it is the right
second step — it answers "tell me when something happens", which the device fix
does not. It is deferred because it turns an anonymous report into an identified
one, and that needs decisions nobody has made: channel, consent copy, retention
period, opt-out handling, and a real sender account. The `nf_communications`
outbox and delivery worker already exist, so the plumbing is partly there when
it is time.

Same discipline as `EMERGENCY_CONTACTS` staying deliberately empty: do not wire
a notification channel to a placeholder sender.

**Short human-readable codes** (`PW-4F2K`). Genuinely better than a UUID for
saying out loud, but it needs a new indexed column, collision retry on insert,
a lookup path, and a backfill. Worth doing on its own, not smuggled in here.

## Verification

Add as Phase G to `docs/e2e-browser-tests.md`:

- File a report, close the tab, return to `/track` → the report is listed and
  opens.
- Filing twice lists both, newest first.
- "Forget these" empties the list; the reports themselves still open by URL.
- Private/incognito window: filing still succeeds, `/track` shows the empty
  state, nothing throws.
- The copy control actually puts a working URL on the clipboard.
