'use client';

// Anonymous, category-first conversational intake — the resident just talks, the
// agent discerns the category, then asks that category's specific questions, and
// shows a complete, routed report. Drives /api/v2/converse. No login.
//
// NOTE: this is the preview of the new /report experience, mounted at
// /report/chat so the existing /report stays intact until this is proven.
//
// Finishing FILES the report: POST /api/v2/submit-anon persists it and opens
// the owning department's workflow, route-direct — no staff confirm gate. The
// resident gets a reference number back. Whether safety-critical categories
// get a clerk step first is a server-side flag (engine/intake/flows.ts),
// pending Blake's decision D; nothing here changes either way.

import { useEffect, useRef, useState } from 'react';
import styles from './chat.module.css';
import { pinStillApplies } from '@/lib/location-text';
import { rememberReport } from '@/lib/report-memory';
import { intakeSessionId, resetIntakeSession } from '@/lib/intake-session';

type FieldType = 'text' | 'longtext' | 'number' | 'boolean' | 'choice' | 'location' | 'date' | 'attachment';
type Field = { key: string; label: string; type: FieldType; required: boolean; choices?: string[]; prompt?: string };
type Form = { key: string; title: string; fields: Field[] };
// 'detected' is a system card, not chat text: the moment the agent works out
// what kind of report this is and where it routes.
// 'emergency' is the hard stop — a life-safety interruption that replaces the
// next intake question instead of decorating it.
type EmergencyKind = 'life_safety' | 'gas' | 'power' | 'water';
type Msg = {
  role: 'user' | 'assistant' | 'detected' | 'emergency';
  text: string;
  dept?: string;
  kind?: EmergencyKind;
};
type CategoryOption = { key: string; label: string; department: string; form: Form };
type Value = {
  fieldKey: string;
  value: string | number | boolean | null;
  /** Blob URLs for an attachment field. */
  attachmentIds?: string[];
  /** Geocoder resolution for a location field. */
  geo?: { lat: number; lon: number; matched: string };
};

const GREETING = 'Hi — I can help you report something to the city. In a sentence or two, what’s going on?';
const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type Candidate = { matched: string; lat: number; lon: number; label?: string };

/**
 * The ambiguous-location picker: candidate pins on a small map, each with a
 * button named in words a resident actually holds — "A — near Northwoods
 * Mall", never "N Frye Rd & Knoxville Ave" (nobody standing at the corner
 * knows there's a North and an East Frye; the sign just says Frye. Rajeev,
 * 2026-08-18). The map is served by our own /api/v2/staticmap proxy; if it
 * can't render, it hides and the labeled buttons carry the choice alone.
 */
function CandidateMap({
  candidates,
  selected,
  onPick,
}: {
  candidates: Candidate[];
  selected: string;
  onPick: (c: Candidate) => void;
}) {
  const [mapBroken, setMapBroken] = useState(false);
  const letters = ['A', 'B', 'C', 'D'];
  const pins = candidates.map((c) => `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`).join('|');
  return (
    <div style={{ margin: '0.4rem 0 0.2rem' }}>
      {!mapBroken && (
        <img
          src={`/api/v2/staticmap?pins=${encodeURIComponent(pins)}`}
          alt="Map showing each possible spot, lettered to match the choices below"
          onError={() => setMapBroken(true)}
          style={{
            width: '100%',
            maxWidth: 480,
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.25)',
            display: 'block',
          }}
        />
      )}
      {/* Label on its own line, then one full-width choice per line — on a
          phone the old wrapping row put the label and A together with B
          orphaned underneath (Rajeev, 2026-08-19). */}
      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--muted-2, #7b8794)',
          margin: '0.4rem 0 0.3rem',
        }}
      >
        Which spot did you mean?
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxWidth: 480 }}>
        {candidates.map((c, i) => {
          const active = c.matched === selected;
          return (
            <button
              key={c.matched}
              type="button"
              onClick={() => onPick(c)}
              // The formal street name still exists for whoever wants it —
              // as a hover/long-press title, not as the choice itself.
              title={c.matched.replace(/, USA$/, '')}
              className={styles.pinAlt}
              aria-pressed={active}
              style={{
                width: '100%',
                textAlign: 'left',
                ...(active
                  ? { borderColor: 'rgba(56, 189, 248, 0.7)', fontWeight: 600 }
                  : undefined),
              }}
            >
              {letters[i] ?? '•'} — {c.label ?? c.matched.replace(/, USA$/, '')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Where a resident photo lands in the Blob store. /api/v2/upload will only sign
// this shape, so keep the two in step: reports/<safe-name>.<image-ext>. The
// store adds a random suffix, so collisions aren't our problem here.
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
function blobPathname(file: File): string {
  const ext = EXT_BY_TYPE[file.type] || file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const base =
    file.name
      .replace(/\.[^.]*$/, '')
      .replace(/[^A-Za-z0-9_-]/g, '-')
      .slice(0, 60) || 'photo';
  return `reports/${base}.${ext}`;
}

export default function ReportChat() {
  const [messages, setMessages] = useState<Msg[]>([{ role: 'assistant', text: GREETING }]);
  const [category, setCategory] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [draft, setDraft] = useState<Value[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'chat' | 'review' | 'done'>('chat');
  const [edited, setEdited] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // `for` is the location text this pin was resolved FROM. It is not decoration:
  // the review screen lets the resident edit that text, and a pin that no longer
  // matches what the field says is a wrong pin, not a stale one.
  const [geo, setGeo] = useState<
    { fieldKey: string; matched: string; lat: number; lon: number; for: string } | null
  >(null);
  // `photos` holds the stored Blob URL (what a submission will record);
  // `photoPreviews` holds a local object URL, because the Blob store is private
  // and its URLs need a signed request — we already have the file in hand.
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({});
  // The photo escape hatch: a report is never blocked over a photo, but
  // skipping one requires a reason, which travels with the record to the crew.
  const [noPhotoReason, setNoPhotoReason] = useState<Record<string, string>>({});
  // The agent's own quick answers for its latest question (beats the schema
  // fallback — it matches whatever the agent actually asked).
  const [suggested, setSuggested] = useState<string[]>([]);
  // Life-safety warnings this resident has already seen and dismissed. Echoed to
  // the server so the same one can't wall them out of finishing their report,
  // while a DIFFERENT danger still stops them.
  const [ackedEmergencies, setAckedEmergencies] = useState<EmergencyKind[]>([]);
  // Alternate geocoder pins — the top one auto-pins; these let the resident
  // tap the spot they meant instead of typing a correction. `label` is the
  // resident-friendly anchor the server attached ("near Northwoods Mall").
  const [geoCandidates, setGeoCandidates] = useState<
    { matched: string; lat: number; lon: number; label?: string }[]
  >([]);
  // A re-pin is in flight for an address edited on the review screen.
  const [repinning, setRepinning] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<CategoryOption[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The filed report's id — the resident's handle on it from here on.
  const [tracking, setTracking] = useState('');
  // Did this device manage to write the report down? False means private mode
  // or blocked storage, and the resident needs telling — otherwise they leave
  // trusting a /track list that will be empty when they come back.
  const [remembered, setRemembered] = useState(false);
  // Transient states for the done screen's copy control.
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [canShare, setCanShare] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  // The re-pin a blur kicked off, if one is still in the air — see repinLocation.
  const repinRef = useRef<Promise<{
    fieldKey: string;
    matched: string;
    lat: number;
    lon: number;
    for: string;
  } | null> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    // The page (not .thread) is often the real scroller — .wrap is
    // min-height, so the thread grows instead of overflowing. And the
    // composer sits BELOW the thread, so "newest message visible" still left
    // the input under the fold — follow all the way to the page bottom.
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, ready, suggested]);

  // Feature-detected once, after mount rather than during render — the share
  // button is an enhancement, and a server render that disagrees with the
  // client is a worse bug than not offering it.
  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  // `quick` may be a chip's value; the composer's onClick passes a MouseEvent,
  // so only trust it when it's actually a string.
  async function send(quick?: unknown) {
    const text = (typeof quick === 'string' ? quick : input).trim();
    if (!text || busy) return;
    // Everything needed to put the conversation back exactly as it was if the
    // turn never lands. A failed send must cost the resident nothing.
    const priorMessages = messages;
    const priorSuggested = suggested;
    setInput('');
    setError('');
    setSuggested([]); // stale chips must not outlive the question they answered
    const nextHistory = [...messages, { role: 'user' as const, text }];
    setMessages(nextHistory);
    setBusy(true);
    try {
      const res = await fetch('/api/v2/converse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 'detected' cards are UI-only — never send them as conversation turns.
        body: JSON.stringify({
          message: text,
          history: messages.filter((m) => m.role !== 'detected' && m.role !== 'emergency'),
          draft,
          category,
          acknowledgedEmergencies: ackedEmergencies,
          // Which conversation this turn belongs to, so an abandoned one can be
          // counted. Tab-scoped and random — not a person. See
          // lib/intake-session.ts.
          sessionId: intakeSessionId(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Something went wrong.');

      // The hard stop replaces this turn entirely: no question, no chips, no
      // progress toward filing. Their message stays in the thread — nothing they
      // said is discarded — and they can carry on once they've acknowledged it.
      if (data.phase === 'emergency') {
        setMessages([...nextHistory, { role: 'emergency', text: data.reply, kind: data.emergency?.kind }]);
        setSuggested([]);
        return;
      }

      // Surface the detection as its own visible moment the first time it lands.
      const justDetected = data.category && !category;
      setMessages([
        ...nextHistory,
        ...(justDetected
          ? [{ role: 'detected' as const, text: data.category, dept: data.department }]
          : []),
        { role: 'assistant', text: data.reply },
      ]);
      if (data.category) {
        setCategory(data.category);
        setDepartment(data.department ?? null);
        if (data.form) setForm(data.form);
        if (Array.isArray(data.draft)) setDraft(data.draft);
        setReady(Boolean(data.readyForReview));
      }
      if (Array.isArray(data.suggestions)) setSuggested(data.suggestions);
      if (data.geo) setGeo(data.geo);
      if (Array.isArray(data.geoCandidates) && data.geoCandidates.length)
        setGeoCandidates(data.geoCandidates);
    } catch (e: any) {
      setError(e.message);
      // The turn did not happen. Roll the thread back so the unprocessed message
      // can't be replayed as history next turn, restore the chips it cleared, and
      // hand the resident their words back in the composer — a rate-limit trip
      // used to silently eat a dictated sentence and force a full retype
      // (Blake 1.4). Never clobber anything they typed while waiting.
      setMessages(priorMessages);
      setSuggested(priorSuggested);
      // Put their words back in front of anything they started typing while the
      // turn was in flight — an LLM turn takes seconds, and `current || text`
      // would have dropped the original message entirely the moment they began
      // a second thought. Same merge the mic uses.
      setInput((current) => (current ? `${text} ${current}` : text));
    } finally {
      setBusy(false);
    }
  }

  async function openPicker() {
    setPicking(true);
    if (allCategories) return;
    try {
      const res = await fetch('/api/v2/categories');
      const data = await res.json();
      setAllCategories(data.categories ?? []);
    } catch {
      setError('Could not load the list of report types.');
      setPicking(false);
    }
  }

  // The resident corrects a mis-read: switch to their category, load its form,
  // and keep only the answers that still apply to the new set of questions.
  function chooseCategory(opt: CategoryOption) {
    setCategory(opt.key);
    setDepartment(opt.department);
    setForm(opt.form);
    const keep = new Set(opt.form.fields.map((f) => f.key));
    setDraft((d) => d.filter((v) => keep.has(v.fieldKey)));
    setReady(false);
    setPicking(false);
    setMessages((m) => [
      ...m,
      { role: 'detected', text: opt.key, dept: opt.department },
      { role: 'assistant', text: `Thanks — I've switched this to ${opt.label.toLowerCase()}. Let's carry on.` },
    ]);
  }

  async function onPickPhoto(fieldKey: string, file: File | null) {
    if (!file) return;
    setUploadingKey(fieldKey);
    setError('');
    try {
      // presigned-URL flow — the file streams straight to Blob storage
      const { uploadPresigned } = await import('@vercel/blob/client');
      const blob = await uploadPresigned(blobPathname(file), file, {
        access: 'private',
        contentType: file.type || undefined,
        handleUploadUrl: '/api/v2/upload',
      });
      setPhotos((p) => ({ ...p, [fieldKey]: blob.url }));
      setPhotoPreviews((p) => {
        if (p[fieldKey]) URL.revokeObjectURL(p[fieldKey]);
        return { ...p, [fieldKey]: URL.createObjectURL(file) };
      });
    } catch (e: any) {
      // The Blob client masks our route's response with a generic "Failed to
      // retrieve the presigned URL", so ask the route directly whether photo
      // storage is simply unconfigured (the one error it reports before it
      // looks at the body at all).
      const msg = String(e?.message ?? '');
      if (/presigned URL|client token/i.test(msg)) {
        const reason = await fetch('/api/v2/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'blob.config-probe' }),
        })
          .then(async (r) => (r.status === 503 ? (await r.json())?.error : null))
          .catch(() => null);
        setError(reason || 'Photo upload isn’t available right now — you can finish without a photo.');
      } else {
        setError(`Photo upload failed: ${msg || 'please try again'}`);
      }
    } finally {
      setUploadingKey(null);
    }
  }

  // The conversation geocodes as a side effect of each turn (see
  // /api/v2/converse) — but an address edited on the REVIEW screen reaches no
  // turn at all. Without this, correcting the address changed the words on the
  // record and left the map pin exactly where the original phrasing had put it.
  //
  // Returns the pin that now applies (or null) rather than relying on the state
  // it sets, so finish() can act on the answer without racing a re-render.
  type Pin = { fieldKey: string; matched: string; lat: number; lon: number; for: string };

  /** Hands finish() the re-pin a blur already started, instead of letting it
   *  fire a competing second lookup — which the geocode rate limiter would
   *  reject, throwing away a perfectly good pin because the resident clicked
   *  Finish quickly. */
  function repinLocation(fieldKey: string, text: string): Promise<Pin | null> {
    const p = runRepin(fieldKey, text);
    repinRef.current = p;
    p.finally(() => {
      if (repinRef.current === p) repinRef.current = null;
    }).catch(() => {});
    return p;
  }

  async function runRepin(fieldKey: string, text: string): Promise<Pin | null> {
    const location = text.trim();
    if (!location) {
      setGeo(null);
      setGeoCandidates([]);
      return null;
    }
    setRepinning(true);
    try {
      const res = await fetch('/api/v2/geocode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ location }),
      });
      const data = await res.json();
      const candidates: { matched: string; lat: number; lon: number }[] = Array.isArray(
        data?.candidates,
      )
        ? data.candidates
        : [];
      const next: Pin | null = candidates[0] ? { fieldKey, ...candidates[0], for: location } : null;
      setGeo(next);
      setGeoCandidates(candidates);
      return next;
    } catch {
      // Fail-soft, and fail-closed on the pin: no pin beats a wrong pin. The
      // report still files on the resident's own words, which is what the crew
      // reads anyway.
      setGeo(null);
      setGeoCandidates([]);
      return null;
    } finally {
      setRepinning(false);
    }
  }

  /** The pin currently on screen, but only if it still describes what the
   *  location field says. Anything else is a pin for a different address. */
  function livePin(): Pin | null {
    if (!geo) return null;
    const text = edited[geo.fieldKey];
    // In chat there is nothing to contradict it — `edited` is only populated
    // once the review screen opens.
    if (phase !== 'review') return geo;
    return pinStillApplies(geo.for, typeof text === 'string' ? text : '') ? geo : null;
  }

  function openReview() {
    const init: Record<string, string | boolean> = {};
    const reasons: Record<string, string> = {};
    for (const f of form?.fields ?? []) {
      const v = draft.find((d) => d.fieldKey === f.key)?.value;
      if (f.type === 'boolean') init[f.key] = v === true;
      else if (v != null) init[f.key] = String(v);
      // If they already explained in chat why they have no photo, carry that
      // through instead of asking them to type it a second time.
      if (f.type === 'attachment' && typeof v === 'string' && v.trim()) reasons[f.key] = v;
    }
    setEdited(init);
    setNoPhotoReason((prior) => ({ ...reasons, ...prior }));
    setError('');
    setPhase('review');
  }

  // A reason for having no photo can arrive two ways: typed on the review screen,
  // or simply said in the conversation (where it lands in the field's own draft
  // value). Both are the resident telling us the same thing, so both count.
  //
  // Once the review screen has seeded the box, that box is authoritative —
  // presence of the KEY, not truthiness of its value. Falling back to the draft
  // whenever the box was empty meant a resident who deleted the pre-filled
  // reason still filed it: the screen showed one thing and the record kept
  // another, with no way to retract.
  function skipReason(fieldKey: string): string {
    if (fieldKey in noPhotoReason) return noPhotoReason[fieldKey].trim();
    const said = draft.find((d) => d.fieldKey === fieldKey)?.value;
    return typeof said === 'string' ? said.trim() : '';
  }

  async function finish() {
    if (submitting) return;

    // Mirror the server's required-attachment rule so the resident sees the
    // problem here rather than after a round trip. The server re-checks — this
    // is a courtesy, not the enforcement.
    const needsPhoto = (form?.fields ?? []).filter(
      (f) => f.type === 'attachment' && f.required && !photos[f.key] && !skipReason(f.key),
    );
    if (needsPhoto.length) {
      setError(
        'This kind of report needs a photo — add one above, or tell us why you can’t provide one.',
      );
      return;
    }

    setSubmitting(true);
    setError('');

    // A pin ships only with the words it was resolved from. If the resident
    // edited the address on this screen — or edited it and hit Finish before the
    // field lost focus — re-pin now. Filing the old coordinates under new text
    // sends a crew to the wrong corner, and no screen would have contradicted
    // it. If the re-pin finds nothing, the report files on their words alone.
    const locField = (form?.fields ?? []).find((f) => f.type === 'location');
    // A blur-triggered re-pin may still be in the air. Its result is the current
    // pin — and `geo` in this closure is the value from before it resolved, so
    // the awaited answer has to win.
    let pin = repinRef.current ? await repinRef.current : geo;
    if (locField) {
      const text = typeof edited[locField.key] === 'string' ? (edited[locField.key] as string) : '';
      const resolvedFrom = pin?.fieldKey === locField.key ? pin.for : null;
      if (!pinStillApplies(resolvedFrom, text)) pin = await repinLocation(locField.key, text);
    }

    const values: Value[] = (form?.fields ?? []).map((f) => {
      const raw = edited[f.key];
      let value: string | number | boolean | null = raw ?? null;
      if (f.type === 'boolean') value = raw === true;
      else if (f.type === 'number' && raw != null && raw !== '') value = Number(raw);

      const out: Value = { fieldKey: f.key, value };
      if (f.type === 'attachment') {
        if (photos[f.key]) {
          // The stored Blob URL is the attachment; the field itself has no value.
          out.value = null;
          out.attachmentIds = [photos[f.key]];
        } else {
          // No photo — the field's value is the resident's reason (or null).
          out.value = skipReason(f.key) || null;
        }
      }
      // Belt and braces: `pin` was just reconciled above, but this is the last
      // line before coordinates become part of an append-only record.
      if (f.type === 'location' && pin?.fieldKey === f.key && pinStillApplies(pin.for, String(raw ?? ''))) {
        out.geo = { lat: pin.lat, lon: pin.lon, matched: pin.matched };
      }
      return out;
    });

    try {
      const res = await fetch('/api/v2/submit-anon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The conversation rides along so it can be preserved into the record —
        // the crew reads what the resident actually said, not just the fields we
        // distilled out of it.
        //
        // 'detected' and 'emergency' cards are the APP speaking, not the
        // conversation. The server maps every non-'assistant' role to
        // "Resident:", so letting an emergency card through would file our own
        // 911 copy into an append-only ledger as the caller's words.
        body: JSON.stringify({
          category,
          values,
          source: 'voice',
          sessionId: intakeSessionId(),
          history: messages
            .filter((m) => m.role !== 'detected' && m.role !== 'emergency')
            .map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not file your report — please try again.');
      const id = String(data.submissionId ?? '');
      setDraft(values);
      setTracking(id);
      // Write the breadcrumb before the done screen paints, so /track is
      // already right if they leave immediately. rememberReport never throws —
      // that matters here, because a throw would land in the catch below and
      // tell someone their report failed when it is already filed.
      //
      // The server's category/department win: submit-anon reroutes to a staffed
      // desk when the canonical owner has no passcode, and the list should name
      // who actually has it. `pin` — not `geo` — is the reconciled pin from a
      // few lines up; a stale address is the one thing worse than no address.
      setRemembered(
        rememberReport({
          id,
          category: String(data.category ?? category ?? ''),
          department: String(data.department ?? department ?? ''),
          filedAt: new Date().toISOString(),
          ...(pin?.matched ? { matched: pin.matched } : {}),
        }),
      );
      // This conversation is over. The next report filed from this tab starts
      // its own funnel rather than extending a very long one. Safe here: the
      // server already recorded 'filed' against the old id.
      resetIntakeSession();
      setPhase('done');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Voice input via Deepgram (the same accurate transcription the old /report
  // uses) instead of the browser's built-in speech API — record, then POST the
  // audio to /api/v2/transcribe and drop the transcript into the composer.
  async function toggleMic() {
    if (recording) {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setRecording(false);
      return;
    }
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = transcribe;
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setError('Couldn’t reach your microphone — you can type instead.');
    }
  }

  async function transcribe() {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    if (blob.size === 0) return;
    setTranscribing(true);
    try {
      const res = await fetch('/api/v2/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/webm' },
        body: blob,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Transcription failed — you can type instead.');
      } else {
        const t = String(data?.transcript ?? '').trim();
        if (t) setInput((prev) => (prev ? `${prev} ${t}` : t));
      }
    } catch {
      setError('Network hiccup during transcription.');
    } finally {
      setTranscribing(false);
    }
  }

  // ── the handle ──
  //
  // A UUID printed as plain text is the worst available handle on a report: the
  // resident is asked to hand-transcribe 36 characters of hex, and nobody will.
  // These give them a link instead.

  async function copyLink(url: string) {
    setCopyFailed(false);
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    };
    try {
      await navigator.clipboard.writeText(url);
      done();
      return;
    } catch {
      // navigator.clipboard needs a secure context and a permission that some
      // in-app browsers refuse. Fall through — a copy button that silently does
      // nothing is worse than no copy button.
    }
    try {
      const el = document.createElement('textarea');
      el.value = url;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.top = '0';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (!ok) throw new Error('copy rejected');
      done();
    } catch {
      // Last resort is honesty: show the URL so they can select it themselves.
      setCopyFailed(true);
    }
  }

  // Progressive enhancement only — where the OS has a share sheet, the resident
  // can text the link to themselves instead of us collecting a phone number.
  async function shareLink(url: string) {
    try {
      await navigator.share({ title: 'My report to the city', url });
    } catch {
      // Cancelled, or the sheet refused. Nothing to say: the link is still on
      // screen and still copyable.
    }
  }

  const routedBanner = category ? (
    <span className={styles.city}>
      {pretty(category)}
      {department ? ` · routed to ${pretty(department)}` : ''}
    </span>
  ) : (
    <span className={styles.city}>Peoria, IL</span>
  );

  if (phase === 'done') {
    const shown = (form?.fields ?? []).filter((f) => f.type !== 'attachment');
    const trackPath = `/track/${tracking}`;
    // Absolute, because the point of copying is to paste it somewhere else.
    // This branch only ever renders after a submit, so window is real here.
    const trackUrl =
      typeof window === 'undefined' ? trackPath : `${window.location.origin}${trackPath}`;
    return (
      <main className={styles.wrap}>
        <div className={styles.done}>
          <div className={styles.check}>✓</div>
          <div className={styles.doneTitle}>Your report is complete</div>
          <p className={styles.doneText}>
            <strong>{form ? pretty(category ?? form.key) : 'Report'}</strong>
            {department ? <> · routed to <strong>{pretty(department)}</strong></> : null}
          </p>
          {geo && (
            <p className={styles.doneText} style={{ opacity: 0.85 }}>
              📍 {geo.matched}
            </p>
          )}
          <div style={{ textAlign: 'left', margin: '1rem auto 0', maxWidth: 460 }}>
            {shown.map((f) => {
              const v = draft.find((d) => d.fieldKey === f.key)?.value;
              const display = f.type === 'boolean' ? (v === true ? 'Yes' : 'No') : v == null || v === '' ? '—' : String(v);
              return (
                <div key={f.key} className={styles.field}>
                  <label className={styles.label}>{f.label}</label>
                  <div>{display}</div>
                </div>
              );
            })}
          </div>
          {Object.keys(photoPreviews).length > 0 && (
            <div style={{ margin: '1rem auto 0', maxWidth: 460, textAlign: 'left' }}>
              {Object.values(photoPreviews).map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={url}
                  alt="report photo"
                  style={{ maxWidth: '180px', borderRadius: 8, display: 'block', marginTop: 6 }}
                />
              ))}
            </div>
          )}
          <p className={styles.doneText} style={{ marginTop: '1rem', opacity: 0.75 }}>
            This has gone straight to {department ? pretty(department) : 'the owning department'} — no desk in between.
          </p>
          {tracking && (
            <div className={styles.handle}>
              <a className={styles.trackLink} href={trackPath}>
                Track this report →
              </a>
              <div className={styles.handleActions}>
                <button className={styles.secondary} type="button" onClick={() => copyLink(trackUrl)}>
                  {copied ? 'Copied ✓' : 'Copy link'}
                </button>
                {canShare && (
                  <button className={styles.secondary} type="button" onClick={() => shareLink(trackUrl)}>
                    Share
                  </button>
                )}
              </div>
              <p className={styles.handleNote}>
                {remembered ? (
                  <>
                    Saved on this device — find it again at{' '}
                    <a className={styles.inlineLink} href="/track">
                      /track
                    </a>
                    .
                  </>
                ) : (
                  <>This browser won’t save it, so keep the link somewhere.</>
                )}
              </p>
              {copyFailed && (
                <p className={styles.handleNote}>
                  Couldn’t reach the clipboard — the link is <span className={styles.ref}>{trackUrl}</span>
                </p>
              )}
              {/* The fallback, not the interface. */}
              <p className={styles.refNote}>
                Reference <span className={styles.ref}>{tracking}</span>
              </p>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Quick-reply chips. The agent's own suggestions win — they match whatever
  // it actually asked (even improvised clarifications). Fallback: when the
  // next unanswered required field is a choice or yes/no, serve its options.
  // Typing always still works.
  const nextAsk =
    form && !ready && !busy
      ? form.fields.find((f) => {
          if (!f.required || f.type === 'attachment') return false;
          const v = draft.find((d) => d.fieldKey === f.key)?.value;
          return v == null || v === '';
        })
      : null;
  const schemaChips =
    nextAsk?.type === 'choice' && nextAsk.choices?.length
      ? nextAsk.choices
      : nextAsk?.type === 'boolean'
        ? ['yes', 'no']
        : null;
  const quickChips = busy || ready ? null : suggested.length ? suggested : schemaChips;

  return (
    <main className={styles.wrap}>
      <div className={styles.glow} aria-hidden />
      <div className={styles.header}>
        <a href="/" className={styles.brand}>
          <span className={styles.brandDot} />
          Neuronify
        </a>
        {routedBanner}
      </div>
      {phase === 'chat' && messages.length <= 1 && (
        <div className={styles.hero}>
          <div className={styles.title}>Report an issue</div>
          <h1 className={styles.heroPrompt}>
            What needs <span className={styles.heroIt}>fixing?</span>
          </h1>
          <p className={styles.heroSub}>
            Talk or type — a pothole, a dark street, a broken sign. We’ll read it back before
            anything is filed.
          </p>
          {/* Said BEFORE the first word, not after. This is voice intake: people
              speak names, addresses and phone numbers aloud without thinking about
              where it lands. The conversation is kept as part of the case record
              (docs/transcript-retention.md) — telling them once it is already
              written down is not telling them. */}
          <p className={styles.retention}>
            Your conversation is saved with your report and can be read by city staff. It may
            form part of the public record, so please leave out anything you wouldn’t want kept
            on file.
          </p>
        </div>
      )}

      {/* In review the pin is rendered under the address field itself, not up
          here. Floating above the card it read as an unrelated page header —
          the field showed the resident's words, the banner showed an address,
          and nothing said the two were about each other. */}
      {phase !== 'review' && geo && (
        <div
          style={{
            margin: '0.4rem 0 0.2rem',
            fontSize: '0.82rem',
            opacity: 0.85,
            display: 'flex',
            gap: '0.4rem',
            alignItems: 'baseline',
          }}
          title={`${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)}`}
        >
          <span>📍</span>
          <span>Location found: <strong>{geo.matched}</strong></span>
        </div>
      )}
      {phase !== 'review' && geo && geoCandidates.length > 1 && (
        <CandidateMap
          candidates={geoCandidates}
          selected={geo.matched}
          // Same query, different result — the text this pin was resolved
          // from is unchanged, so it still applies to the same address.
          onPick={(c) =>
            setGeo({ fieldKey: geo.fieldKey, matched: c.matched, lat: c.lat, lon: c.lon, for: geo.for })
          }
        />
      )}

      {phase === 'chat' && (
        <>
          <div className={styles.thread} ref={threadRef}>
            {messages.map((m, i) =>
              m.role === 'detected' ? (
                <div
                  key={i}
                  style={{
                    alignSelf: 'center',
                    margin: '0.6rem 0',
                    padding: '0.7rem 1rem',
                    borderRadius: 12,
                    border: '1px solid rgba(56,189,248,.35)',
                    background: 'rgba(56,189,248,.08)',
                    textAlign: 'center',
                    maxWidth: '90%',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', letterSpacing: '.14em', textTransform: 'uppercase', opacity: 0.7 }}>
                    Identified
                  </div>
                  <div style={{ fontSize: '1.02rem', fontWeight: 600, margin: '0.25rem 0' }}>
                    {pretty(m.text)}
                  </div>
                  <div style={{ fontSize: '0.86rem', opacity: 0.85 }}>
                    → routed to <strong>{pretty(m.dept ?? '')}</strong>
                  </div>
                  {i === messages.map((x) => x.role).lastIndexOf('detected') && (
                    <button
                      type="button"
                      onClick={openPicker}
                      style={{
                        marginTop: '0.5rem',
                        background: 'none',
                        border: 'none',
                        color: 'inherit',
                        opacity: 0.7,
                        fontSize: '0.8rem',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                      }}
                    >
                      Not right? Change it
                    </button>
                  )}
                </div>
              ) : m.role === 'emergency' ? (
                // The hard stop. Loud on purpose, and it does not look like the
                // assistant's ordinary voice — this is not part of filing.
                <div key={i} className={styles.emergency} role="alert">
                  <div className={styles.emergencyHead}>Please stop and read this</div>
                  {m.text.split('\n\n').map((para, k) => (
                    <p key={k} className={styles.emergencyBody}>
                      {para}
                    </p>
                  ))}
                  <a className={styles.emergencyCall} href="tel:911">
                    Call 911
                  </a>
                  {/* Only on the newest card, only until it's acknowledged, and
                      never mid-turn: a response landing afterwards is built from
                      a pre-flight snapshot and would erase the confirmation
                      line, rewriting the thread under the resident. */}
                  {i === messages.map((x) => x.role).lastIndexOf('emergency') &&
                    !(m.kind && ackedEmergencies.includes(m.kind)) && (
                      <button
                        type="button"
                        className={styles.emergencyAck}
                        disabled={busy}
                        onClick={() => {
                          if (!m.kind || ackedEmergencies.includes(m.kind)) return;
                          setAckedEmergencies((prior) => [...prior, m.kind!]);
                          setMessages((prev) => [
                            ...prev,
                            {
                              role: 'assistant',
                              text: 'Thanks for taking care of that first. Whenever you’re ready, tell me what you’d like to report to the city.',
                            },
                          ]);
                        }}
                      >
                        I’ve done that — carry on with my report
                      </button>
                    )}
                </div>
              ) : (
                <div key={i} className={`${styles.msg} ${m.role === 'user' ? styles.user : styles.assistant}`}>
                  {m.text}
                </div>
              ),
            )}

            {picking && (
              <div className={styles.reviewCard}>
                <div className={styles.reviewHead}>What kind of issue is it?</div>
                <div className={styles.reviewSub}>Pick the one that fits best.</div>
                {!allCategories && <div className={styles.thinking}>Loading…</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem' }}>
                  {(allCategories ?? []).map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => chooseCategory(c)}
                      className={styles.secondary}
                      style={{ fontSize: '0.82rem', padding: '0.4rem 0.7rem' }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className={styles.actions}>
                  <button className={styles.secondary} onClick={() => setPicking(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {busy && <div className={styles.thinking}>Listening…</div>}
            {transcribing && <div className={styles.thinking}>Transcribing…</div>}
            {ready && !busy && (
              <div className={styles.reviewCard}>
                <div className={styles.reviewHead}>I’ve got what I need.</div>
                <div className={styles.reviewSub}>Review the details and finish when you’re ready.</div>
                <button className={styles.primary} onClick={openReview}>
                  Review &amp; finish
                </button>
              </div>
            )}
            {quickChips && !picking && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', margin: '0.2rem 0 0.4rem' }}>
                {quickChips.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => send(c)}
                    className={styles.secondary}
                    style={{ fontSize: '0.82rem', padding: '0.4rem 0.7rem' }}
                  >
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.composer}>
            <button
              className={`${styles.iconBtn} ${recording ? styles.listening : ''}`}
              onClick={toggleMic}
              aria-label={recording ? 'Stop recording' : 'Speak'}
              type="button"
            >
              {recording ? '■' : '🎙'}
            </button>
            <textarea
              className={styles.input}
              value={input}
              rows={1}
              placeholder="Speak or type…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className={styles.sendBtn} onClick={send} disabled={busy || !input.trim()}>
              Send
            </button>
          </div>
        </>
      )}

      {phase === 'review' && form && (
        <div className={styles.reviewCard}>
          <div className={styles.reviewHead}>Review your report</div>
          <div className={styles.reviewSub}>Edit anything that isn’t right, then finish.</div>
          {form.fields.map((f) => {
            // Only the pin that still describes what this field says. A pin for
            // the address they just edited away is not shown at all.
            const pin = f.type === 'location' ? livePin() : null;
            const locText =
              f.type === 'location' && typeof edited[f.key] === 'string'
                ? (edited[f.key] as string).trim()
                : '';
            return (
            <div key={f.key} className={styles.field}>
              <label className={styles.label}>
                {f.label} {f.required && <span className={styles.req}>*</span>}
              </label>
              {f.type === 'attachment' ? (
                <div>
                  {photoPreviews[f.key] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoPreviews[f.key]}
                      alt="uploaded"
                      style={{ maxWidth: '180px', borderRadius: 8, display: 'block', marginTop: 4 }}
                    />
                  )}
                  {/* The picker stays after a selection (relabelled "Replace") —
                      destroying it stranded residents with no way to retry a
                      photo the server wouldn't accept. */}
                  <label style={{ display: 'block', marginTop: 4 }}>
                    {photoPreviews[f.key] && (
                      <span className={styles.attachNote}>Replace photo: </span>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={uploadingKey === f.key}
                      onChange={(e) => onPickPhoto(f.key, e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {uploadingKey === f.key && <span className={styles.attachNote}> Uploading…</span>}
                  {!photos[f.key] && uploadingKey !== f.key && (
                    <span className={styles.attachNote}>
                      {f.required
                        ? ' (required for this kind of report — snap or attach a photo)'
                        : ' (optional — snap or attach a photo)'}
                    </span>
                  )}
                  {f.required && !photos[f.key] && (
                    <input
                      type="text"
                      className={styles.fieldInput}
                      style={{ marginTop: 6 }}
                      placeholder="Can’t provide a photo? Tell the crew why…"
                      value={noPhotoReason[f.key] ?? ''}
                      onChange={(e) =>
                        setNoPhotoReason((r) => ({ ...r, [f.key]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ) : f.type === 'boolean' ? (
                <select
                  className={styles.fieldSelect}
                  value={edited[f.key] === true ? 'yes' : 'no'}
                  onChange={(e) => setEdited({ ...edited, [f.key]: e.target.value === 'yes' })}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : f.type === 'choice' ? (
                <select
                  className={styles.fieldSelect}
                  value={(edited[f.key] as string) ?? ''}
                  onChange={(e) => setEdited({ ...edited, [f.key]: e.target.value })}
                >
                  <option value="">—</option>
                  {f.choices?.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : f.type === 'longtext' ? (
                // A description runs to several sentences — a one-line input
                // hides its own content from the person checking it.
                <textarea
                  className={styles.fieldInput}
                  rows={4}
                  value={(edited[f.key] as string) ?? ''}
                  onChange={(e) => setEdited({ ...edited, [f.key]: e.target.value })}
                />
              ) : f.type === 'location' ? (
                // The field keeps the resident's own words — they are the ground
                // truth, and a formatted postal string is harder to check at a
                // glance than the corner you named. What the geocoder made of
                // them sits directly underneath, where it can be compared.
                <div>
                  <input
                    className={styles.fieldInput}
                    value={(edited[f.key] as string) ?? ''}
                    onChange={(e) => setEdited({ ...edited, [f.key]: e.target.value })}
                    onBlur={(e) => {
                      // Re-pin the moment they leave the field, so a correction
                      // shows its new pin here rather than surfacing as a
                      // surprise on the filed record. finish() re-checks anyway
                      // for anyone who edits and hits Finish in one motion.
                      const text = e.target.value;
                      const resolvedFrom = geo?.fieldKey === f.key ? geo.for : null;
                      if (!pinStillApplies(resolvedFrom, text)) void repinLocation(f.key, text);
                    }}
                  />
                  {repinning ? (
                    <div className={styles.pinNote}>
                      <span className={styles.pinMark}>◍</span>
                      <span>Checking the map…</span>
                    </div>
                  ) : pin ? (
                    <>
                      <div
                        className={styles.pinNote}
                        title={`${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}`}
                      >
                        <span className={styles.pinMark}>📍</span>
                        {/* One flex child, or the sentence breaks into columns. */}
                        <span>
                          On the map as <strong>{pin.matched.replace(/, USA$/, '')}</strong> — this
                          is where the crew will go.
                        </span>
                      </div>
                      {geoCandidates.length > 1 && (
                        <CandidateMap
                          candidates={geoCandidates}
                          selected={pin.matched}
                          // Same query, different result — the text the
                          // pin was resolved from hasn't changed.
                          onPick={(c) =>
                            setGeo({ fieldKey: f.key, matched: c.matched, lat: c.lat, lon: c.lon, for: pin.for })
                          }
                        />
                      )}
                    </>
                  ) : locText ? (
                    // Honest about the gap rather than silent: the report still
                    // files, the crew just gets the address as written.
                    <div className={styles.pinNote}>
                      <span className={styles.pinMark}>◎</span>
                      <span>
                        Couldn’t pin this on the map — the crew will get your address exactly as
                        written. A street or cross-street helps.
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <input
                  className={styles.fieldInput}
                  value={(edited[f.key] as string) ?? ''}
                  onChange={(e) => setEdited({ ...edited, [f.key]: e.target.value })}
                />
              )}
            </div>
            );
          })}
          {error && <div className={styles.error}>{error}</div>}
          {/* Again at the point of commitment. The review screen reads back the
              FIELDS, which quietly implies the fields are all that gets filed —
              the conversation goes with them and is not shown here. Saying so is
              the difference between a record they agreed to and one they didn't
              know about. */}
          <p className={styles.retention}>
            Finishing files this report and saves your conversation with it.
          </p>
          <div className={styles.actions}>
            <button
              className={styles.secondary}
              onClick={() => setPhase('chat')}
              disabled={busy || submitting}
            >
              Back
            </button>
            <button className={styles.primary} onClick={finish} disabled={busy || submitting}>
              {submitting ? 'Filing your report…' : 'Finish'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
