'use client';

// Anonymous, category-first conversational intake — the resident just talks, the
// agent discerns the category, then asks that category's specific questions, and
// shows a complete, routed report. Drives /api/v2/converse. No login.
//
// NOTE: this is the preview of the new /report experience, mounted at
// /report/chat so the existing /report stays intact until this is proven. The
// final step summarizes the complete report + where it routes; actual
// persistence (route-direct submit) is wired once the forms are seeded and
// Blake's auto-route-vs-confirm decision lands.

import { useEffect, useRef, useState } from 'react';
import styles from '../../intake/intake.module.css';

type FieldType = 'text' | 'longtext' | 'number' | 'boolean' | 'choice' | 'location' | 'date' | 'attachment';
type Field = { key: string; label: string; type: FieldType; required: boolean; choices?: string[]; prompt?: string };
type Form = { key: string; title: string; fields: Field[] };
type Msg = { role: 'user' | 'assistant'; text: string };
type Value = { fieldKey: string; value: string | number | boolean | null };

const GREETING = 'Hi — I can help you report something to the city. In a sentence or two, what’s going on?';
const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

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
        body: JSON.stringify({ message: text, history: messages, draft, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Something went wrong.');
      setMessages([...nextHistory, { role: 'assistant', text: data.reply }]);
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

  async function onPickPhoto(fieldKey: string, file: File | null) {
    if (!file) return;
    setUploadingKey(fieldKey);
    setError('');
    try {
      // client-upload token flow — file streams straight to Blob storage
      const { upload } = await import('@vercel/blob/client');
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/v2/upload',
      });
      setPhotos((p) => ({ ...p, [fieldKey]: blob.url }));
    } catch (e: any) {
      setError(e?.message?.includes('not configured')
        ? 'Photo storage isn’t turned on yet — you can finish without a photo for now.'
        : `Photo upload failed: ${e?.message || 'try again'}`);
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

  function finish() {
    // No persistence yet (see file header). Capture the reviewed values so the
    // summary reflects any edits, then show the complete, routed report.
    const values: Value[] = (form?.fields ?? [])
      .filter((f) => f.type !== 'attachment')
      .map((f) => {
        const raw = edited[f.key];
        let value: string | number | boolean | null = raw ?? null;
        if (f.type === 'boolean') value = raw === true;
        else if (f.type === 'number' && raw != null && raw !== '') value = Number(raw);
        return { fieldKey: f.key, value };
      });
    setDraft(values);
    setPhase('done');
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
          {Object.keys(photos).length > 0 && (
            <div style={{ margin: '1rem auto 0', maxWidth: 460, textAlign: 'left' }}>
              {Object.values(photos).map((url, i) => (
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
            In the live flow this goes straight to {department ? pretty(department) : 'the owning department'}. (Submission
            is the next step to wire.)
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
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
            {messages.map((m, i) => (
              <div key={i} className={`${styles.msg} ${m.role === 'user' ? styles.user : styles.assistant}`}>
                {m.text}
              </div>
            ))}
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
                  {photos[f.key] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photos[f.key]}
                      alt="uploaded"
                      style={{ maxWidth: '180px', borderRadius: 8, display: 'block', marginTop: 4 }}
                    />
                  ) : (
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={uploadingKey === f.key}
                      onChange={(e) => onPickPhoto(f.key, e.target.files?.[0] ?? null)}
                    />
                  )}
                  {uploadingKey === f.key && <span className={styles.attachNote}> Uploading…</span>}
                  {!photos[f.key] && uploadingKey !== f.key && (
                    <span className={styles.attachNote}> (optional — snap or attach a photo)</span>
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
            <button className={styles.secondary} onClick={() => setPhase('chat')} disabled={busy}>
              Back
            </button>
            <button className={styles.primary} onClick={finish} disabled={busy}>
              Finish
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
