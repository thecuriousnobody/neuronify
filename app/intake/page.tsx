'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './intake.module.css';

type FieldType = 'text' | 'longtext' | 'number' | 'boolean' | 'choice' | 'location' | 'date' | 'attachment';
type Field = { key: string; label: string; type: FieldType; required: boolean; choices?: string[]; prompt?: string };
type Form = { key: string; title: string; city: string; fields: Field[] };
type Msg = { role: 'user' | 'assistant'; text: string };
type Value = { fieldKey: string; value: string | number | boolean | null };

const GREETING = 'Hi — I can help you report this to the city. In a sentence or two, what’s going on?';

export default function IntakePage() {
  const [form, setForm] = useState<Form | null>(null);
  const [formKey, setFormKey] = useState('pothole_report');
  const [city, setCity] = useState('peoria');
  const [messages, setMessages] = useState<Msg[]>([{ role: 'assistant', text: GREETING }]);
  const [draft, setDraft] = useState<Value[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'chat' | 'review' | 'done'>('chat');
  const [edited, setEdited] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState('');
  const [submissionId, setSubmissionId] = useState('');
  const [listening, setListening] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);

  // read ?form= / ?city= and load the form definition
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fk = q.get('form') || 'pothole_report';
    const c = q.get('city') || 'peoria';
    setFormKey(fk);
    setCity(c);
    fetch(`/api/v2/form/${fk}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setForm)
      .catch(() => setError('Could not load this form.'));
  }, []);

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
      const res = await fetch('/api/v2/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ formKey, history: messages, draft, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Something went wrong.');
      setMessages([...nextHistory, { role: 'assistant', text: data.reply }]);
      setDraft(data.draft);
      setReady(data.readyForReview);
    } catch (e: any) {
      setError(e.message);
      setMessages(nextHistory);
    } finally {
      setBusy(false);
    }
  }

  function openReview() {
    // pre-fill the editable copy from the gathered draft
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

  async function submit() {
    if (!form) return;
    setBusy(true);
    setError('');
    const values: Value[] = form.fields
      .filter((f) => f.type !== 'attachment')
      .map((f) => {
        const raw = edited[f.key];
        let value: string | number | boolean | null = raw ?? null;
        if (f.type === 'boolean') value = raw === true;
        else if (f.type === 'number' && raw != null && raw !== '') value = Number(raw);
        return { fieldKey: f.key, value };
      });
    try {
      const res = await fetch('/api/v2/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ formKey, city, source: 'voice', values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not submit.');
      setSubmissionId(data.submissionId);
      setPhase('done');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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

  if (phase === 'done') {
    return (
      <main className={styles.wrap}>
        <div className={styles.done}>
          <div className={styles.check}>✓</div>
          <div className={styles.doneTitle}>Received</div>
          <p className={styles.doneText}>
            Your {form?.title.toLowerCase()} has been received and entered into the city’s record. You’ll get a
            message at each stage of review.
          </p>
          <a className={styles.trackLink} href={`/track/${submissionId}`}>
            Track its progress →
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>{form ? form.title : 'Neuronify'}</span>
        <span className={styles.city}>{form?.city}</span>
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
                <div className={styles.reviewSub}>Review the details and submit when you’re ready.</div>
                <button className={styles.primary} onClick={openReview}>
                  Review &amp; submit
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
          <div className={styles.reviewSub}>Edit anything that isn’t right, then submit.</div>
          {form.fields.map((f) => (
            <div key={f.key} className={styles.field}>
              <label className={styles.label}>
                {f.label} {f.required && <span className={styles.req}>*</span>}
              </label>
              {f.type === 'attachment' ? (
                <span className={styles.attachNote}>Photo upload coming soon — you can submit without it for now.</span>
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
            <button className={styles.primary} onClick={submit} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit to the city'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
