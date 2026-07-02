'use client';

// The resident's voice door (v2). Tap the mic, speak, and Deepgram transcribes.
// The resident reviews what was heard and sends it to the city — which parks it
// as a pending intake for a staffer to digest and confirm. Frictionless and
// anonymous, matching the "just click a microphone" product vision.

import { useEffect, useRef, useState } from 'react';
import { resolveCity, type City } from '@/lib/cities';
import styles from './report.module.css';

type Phase = 'idle' | 'transcribing' | 'previewing' | 'preview' | 'sending' | 'done';
type Understood = { key: string; label: string; value: unknown; missing: boolean };
type Preview = { understood: Understood[]; category: string; severity: string; department: string };

const SEV_LABEL: Record<string, string> = {
  safety_critical: 'Safety-critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function Report() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [city, setCity] = useState<City>(() => resolveCity(null));

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const usedVoiceRef = useRef(false);

  useEffect(() => {
    setCity(resolveCity(new URLSearchParams(window.location.search).get('city')));
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function startRecording() {
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
      usedVoiceRef.current = true;
      setRecording(true);
    } catch {
      setError('Couldn’t reach your microphone. You can type instead.');
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  }

  async function transcribe() {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    if (blob.size === 0) return;
    setPhase('transcribing');
    try {
      const res = await fetch('/api/v2/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/webm' },
        body: blob,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Transcription failed. You can type instead.');
      } else {
        const t = String(data?.transcript ?? '').trim();
        setText((prev) => (prev ? `${prev} ${t}` : t));
      }
    } catch {
      setError('Network hiccup during transcription.');
    } finally {
      setPhase('idle');
    }
  }

  async function review() {
    const value = text.trim();
    if (!value) {
      setError('Tell the city what’s going on first.');
      return;
    }
    if (recording) stopRecording();
    setError('');
    setPhase('previewing');
    try {
      const res = await fetch('/api/v2/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Couldn’t read that. Try again.');
        setPhase('idle');
        return;
      }
      setPreview(data as Preview);
      setPhase('preview');
    } catch {
      setError('Network hiccup. Try again.');
      setPhase('idle');
    }
  }

  async function send() {
    const value = text.trim();
    if (!value) {
      setError('Tell the city what’s going on first.');
      return;
    }
    if (recording) stopRecording();
    setPhase('sending');
    setError('');
    try {
      const res = await fetch('/api/v2/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: value, city: city.slug, source: usedVoiceRef.current ? 'voice' : 'text' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Something went wrong. Try again.');
        setPhase('idle');
        return;
      }
      setPhase('done');
    } catch {
      setError('Network hiccup. Try again.');
      setPhase('idle');
    }
  }

  function reset() {
    setText('');
    setError('');
    setPreview(null);
    usedVoiceRef.current = false;
    setPhase('idle');
  }

  function editAgain() {
    setPreview(null);
    setPhase('idle');
  }

  return (
    <main className={styles.shell}>
      <div className={styles.glow} />
      <a href="/" className={styles.brand}>
        <span className={styles.brandDot} />
        Neuronify
      </a>

      {phase === 'done' ? (
        <div className={styles.inner}>
          <div className={styles.done}>
            <div className={styles.doneNode} />
            <div className={styles.doneTitle}>
              We’ve got it, <span className={styles.it}>thank you.</span>
            </div>
            <div className={styles.doneSummary}>“{text}”</div>
            <p className={styles.note}>A {city.short} staffer will review your report and route it. You’ll be able to track it soon.</p>
            <button className={styles.again} onClick={reset}>Report another</button>
          </div>
        </div>
      ) : (
        <div className={styles.inner}>
          <div className={styles.eyebrow}>Speak to {city.short}</div>
          <h1 className={styles.prompt}>
            What needs <span className={styles.it}>fixing?</span>
          </h1>
          <p className={styles.sub}>Tap the mic and describe it — a pothole, a dark street, a broken sign. We’ll read it back before you send.</p>

          <button
            type="button"
            className={`${styles.mic} ${recording ? styles.live : ''}`}
            onClick={recording ? stopRecording : startRecording}
            disabled={phase === 'transcribing' || phase === 'previewing' || phase === 'sending'}
            aria-pressed={recording}
          >
            <span className={styles.micRing} />
            <span className={styles.micDot} />
            {recording ? 'Listening… tap to stop' : phase === 'transcribing' ? 'Transcribing…' : 'Tap to speak'}
          </button>

          <textarea
            className={styles.field}
            value={text}
            onChange={(e) => { setText(e.target.value); if (preview) editAgain(); }}
            placeholder="…or type it here."
            maxLength={4000}
            aria-label="Your report to the city"
          />

          {preview ? (
            <>
              <div className={styles.understood}>
                <div className={styles.understoodHead}>
                  <span className={styles.understoodEyebrow}>What we understood</span>
                  <span className={`${styles.sevChip} ${styles[`sev_${preview.severity}`] ?? ''}`}>
                    {SEV_LABEL[preview.severity] ?? preview.severity}
                  </span>
                </div>
                <div className={styles.understoodCat}>{pretty(preview.category)} · routed to {pretty(preview.department)}</div>
                <ul className={styles.understoodList}>
                  {preview.understood.map((u) => (
                    <li key={u.key} className={styles.understoodRow}>
                      <span className={styles.uLabel}>{u.label}</span>
                      {u.missing ? (
                        <span className={styles.uMissing}>we didn’t catch this — add it above</span>
                      ) : (
                        <span className={styles.uValue}>{u.value === true ? 'Yes' : u.value === false ? 'No' : String(u.value)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <button type="button" className={styles.send} onClick={send} disabled={phase === 'sending'}>
                {phase === 'sending' ? 'Sending…' : 'Looks right — send to the city →'}
              </button>
            </>
          ) : (
            <button type="button" className={styles.send} onClick={review} disabled={phase === 'transcribing' || phase === 'previewing'}>
              {phase === 'previewing' ? 'Reading your report…' : 'See what we understood →'}
            </button>
          )}

          {error && <div className={styles.error}>{error}</div>}
          <p className={styles.note}>Anonymous · no login · we only keep what you report</p>
        </div>
      )}
    </main>
  );
}
