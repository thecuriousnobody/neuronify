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
  const [listening, setListening] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);

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
    } catch (e: any) {
      setError(e.message);
      setMessages(nextHistory);
    } finally {
      setBusy(false);
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

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError('Voice input isn’t supported in this browser — you can type instead.');
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.onresult = (e: any) => setInput((prev) => (prev ? prev + ' ' : '') + e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
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

      {phase === 'chat' && (
        <>
          <div className={styles.thread} ref={threadRef}>
            {messages.map((m, i) => (
              <div key={i} className={`${styles.msg} ${m.role === 'user' ? styles.user : styles.assistant}`}>
                {m.text}
              </div>
            ))}
            {busy && <div className={styles.thinking}>Listening…</div>}
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
              className={`${styles.iconBtn} ${listening ? styles.listening : ''}`}
              onClick={toggleMic}
              aria-label="Speak"
              type="button"
            >
              🎙
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
                <span className={styles.attachNote}>Photo upload coming soon — you can finish without it for now.</span>
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
