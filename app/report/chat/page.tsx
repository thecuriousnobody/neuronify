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

type FieldType = 'text' | 'longtext' | 'number' | 'boolean' | 'choice' | 'location' | 'date' | 'attachment';
type Field = { key: string; label: string; type: FieldType; required: boolean; choices?: string[]; prompt?: string };
type Form = { key: string; title: string; fields: Field[] };
// 'detected' is a system card, not chat text: the moment the agent works out
// what kind of report this is and where it routes.
type Msg = { role: 'user' | 'assistant' | 'detected'; text: string; dept?: string };
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
  const [geo, setGeo] = useState<{ fieldKey: string; matched: string; lat: number; lon: number } | null>(null);
  // `photos` holds the stored Blob URL (what a submission will record);
  // `photoPreviews` holds a local object URL, because the Blob store is private
  // and its URLs need a signed request — we already have the file in hand.
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({});
  // The photo escape hatch: a report is never blocked over a photo, but
  // skipping one requires a reason, which travels with the record to the crew.
  const [noPhotoReason, setNoPhotoReason] = useState<Record<string, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<CategoryOption[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The filed report's id — the resident's handle on it from here on.
  const [tracking, setTracking] = useState('');

  const threadRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
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
          history: messages.filter((m) => m.role !== 'detected'),
          draft,
          category,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Something went wrong.');
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
      if (data.geo) setGeo(data.geo);
    } catch (e: any) {
      setError(e.message);
      setMessages(nextHistory);
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

  function openReview() {
    const init: Record<string, string | boolean> = {};
    for (const f of form?.fields ?? []) {
      const v = draft.find((d) => d.fieldKey === f.key)?.value;
      if (f.type === 'boolean') init[f.key] = v === true;
      else if (v != null) init[f.key] = String(v);
    }
    setEdited(init);
    setError('');
    setPhase('review');
  }

  async function finish() {
    if (submitting) return;

    // Mirror the server's required-attachment rule so the resident sees the
    // problem here rather than after a round trip. The server re-checks — this
    // is a courtesy, not the enforcement.
    const needsPhoto = (form?.fields ?? []).filter(
      (f) => f.type === 'attachment' && f.required && !photos[f.key] && !noPhotoReason[f.key]?.trim(),
    );
    if (needsPhoto.length) {
      setError(
        'This kind of report needs a photo — add one above, or tell us why you can’t provide one.',
      );
      return;
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
          out.value = noPhotoReason[f.key]?.trim() || null;
        }
      }
      if (f.type === 'location' && geo?.fieldKey === f.key) {
        out.geo = { lat: geo.lat, lon: geo.lon, matched: geo.matched };
      }
      return out;
    });

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/v2/submit-anon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, values, source: 'voice' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not file your report — please try again.');
      setDraft(values);
      setTracking(String(data.submissionId ?? ''));
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
            <p className={styles.doneText} style={{ marginTop: '0.5rem' }}>
              Your reference number is <strong>{tracking}</strong> — keep it to check on this report.
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.glow} aria-hidden />
      <div className={styles.header}>
        <span className={styles.title}>Report an issue</span>
        {routedBanner}
      </div>

      {geo && (
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
          {form.fields.map((f) => (
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
              ) : (
                <input
                  className={styles.fieldInput}
                  value={(edited[f.key] as string) ?? ''}
                  onChange={(e) => setEdited({ ...edited, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}
          {error && <div className={styles.error}>{error}</div>}
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
