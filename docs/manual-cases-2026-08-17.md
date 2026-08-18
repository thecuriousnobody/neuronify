# The cases a browser agent cannot run — for Rajeev, 2026-08-17

Everything else in `docs/e2e-browser-tests.md` was run and passed on the preview
this session (`docs/e2e-run-2026-08-17.md`). These four are left because each one
is genuinely impossible for the Chrome extension, not because I ran out of road.

**Two real reports get filed by this list.** Both go in the cleanup ledger.

---

## Do it in ONE localhost sitting

G5b and H2 share a filing — block site data, watch the terminal, file once, and
you have both. G5a needs its own (incognito, storage working). So: two filings.

```bash
npm run dev      # leave this terminal VISIBLE — H2 is read here, not in the browser
```

⚠️ **localhost shares the production database.** These are real reports. Prefix
free text `TEST —`, and note the reference numbers.

---

## 1 · G5b — storage blocked, files anyway ⚠️ RUN THIS BEFORE SHIP

*Why not me:* it needs `chrome://settings`, which the extension can't reach.
**LOCALHOST ONLY** — on a preview you'd block the cookies Vercel SSO needs and
never reach the app (this cost you an attempt on 2026-08-10).

1. Go to **`chrome://settings/content/siteData`** → **"Don't allow sites to save
   data on your device."**
   *Not the padlock menu — current Chrome has no first-party block toggle there.*
2. Visit `localhost:3000/track`.
   **Expect:** "This browser isn't saving anything" + the private-browsing note.
3. File a report end to end.
   **Expect:** it **still files**, and the done screen says **"This browser won't
   save it, so keep the link somewhere."**
4. **Fail if** anything throws, the filing fails, or the done screen claims it
   was saved.

**→ While you're on step 3, do H2 below — same filing.**

**Afterwards: set site data back to Allow.** Otherwise every later case silently
runs the blocked path, and you won't be able to open a preview URL at all.

---

## 2 · H2 — the department alert fires at filing, not later

*Why not me:* it's read in the server log, not the browser.

Watch the `npm run dev` terminal at the exact moment the reference number appears.

**Expect:** a `[relay:department:<dept>→…]` line **at filing time**.
With no `DESK_CONTACTS` set it reads `→(no contact)` — **that is a PASS.** The
point is *when* it fires, not whether SMS is wired.

**Fail if** nothing is relayed until you later open that case at the desk. That
was the bug in `3e25ad4`: "a report just came in" only fired once a staffer had
already found the report.

---

## 3 · G5a — incognito isn't broken

*Why not me:* extensions cannot attach to incognito windows.

Incognito window → `/track` → file a report → back to `/track`.

**Expect everything to behave normally:** "No reports on this device" *before*
filing, the report files, done screen says "Saved on this device", and the report
**appears** at `/track` afterwards.

Chrome incognito localStorage genuinely works — it just clears when the window
closes. The list dying with the session is the browser, not us, and is **not** a
failure. (The old version of this case claimed otherwise and gave you a false
alarm on 2026-08-10.)

---

## 4 · E4 — dictate→send isn't throttled *(phone half only)*

*Why not me:* needs a real microphone and a real radio.

⚠️ **Read this before you pick up the phone:** it has to run against the **branch
preview**, and previews sit behind Vercel SSO — so **the phone's browser must be
signed in to Vercel**. `neuronify.ai` is `main` and does not have this fix, so
testing there proves nothing. And you can't shortcut via `http://<laptop-ip>:3000`
either: the mic needs a secure context, so `getUserMedia` won't run over LAN http.

**Do:** dictate a message with the mic and hit send the instant dictation ends.
Three times.
**Expect:** no "Too fast — give it a second." Speech and chat are separate buckets now.

**The other half is already covered** — I verified this session that a send which
doesn't go through leaves your typed sentence sitting in the composer rather than
stranding it in the thread (see C3 in the run doc). So you only owe the dictation
half; skip the airplane-mode step unless you want it belt-and-braces.

---

## What is NOT covered, and is NOT on this list

These four I simply couldn't run here — they are **not** human-only, and they are
**not** tested. Don't count them as green:

| | |
|---|---|
| **C1** mobile 390×844 | `resize_window` was ignored by this Chrome window. Tap targets ≥44 px did verify. |
| **C2** reduced motion | Needs an OS/devtools toggle. |
| **D5** chat follows to composer | Scroll behaviour; needed screenshots I was rationing. |
| **E2** ≤2 batched questions | Never triggered — it asked one question per turn across ~7 conversations. No failure seen, but the path is unproven. |

**These are ~10 minutes of agent work with a frontmost Chrome window.** Worth
letting me do them next session rather than spending your morning on them.
