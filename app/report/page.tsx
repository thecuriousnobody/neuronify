'use client';

// The resident's voice door (v2). Tap the mic, speak, and Deepgram transcribes.
// The resident reviews what was heard and sends it to the city — which parks it
// as a pending intake for a staffer to digest and confirm. Frictionless and
// anonymous, matching the "just click a microphone" product vision.

import { useEffect, useRef, useState } from 'react';
import { resolveCity, type City } from '@/lib/cities';
import styles from './report.module.css';

type Phase = 'idle' | 'transcribing' | 'sending' | 'done';

export default function Report() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
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
    usedVoiceRef.current = false;
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
          <p className={styles.sub}>Tap the mic and describe it — a pothole, a dark street, a broken sign. We’ll take it from there.</p>

          <button
            type="button"
            className={`${styles.mic} ${recording ? styles.live : ''}`}
            onClick={recording ? stopRecording : startRecording}
            disabled={phase === 'transcribing' || phase === 'sending'}
            aria-pressed={recording}
          >
            <span className={styles.micRing} />
            <span className={styles.micDot} />
            {recording ? 'Listening… tap to stop' : phase === 'transcribing' ? 'Transcribing…' : 'Tap to speak'}
          </button>

          <textarea
            className={styles.field}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="…or type it here."
            maxLength={4000}
            aria-label="Your report to the city"
          />

          <button type="button" className={styles.send} onClick={send} disabled={phase === 'sending' || phase === 'transcribing'}>
            {phase === 'sending' ? 'Sending…' : 'Send to the city →'}
          </button>

          {error && <div className={styles.error}>{error}</div>}
          <p className={styles.note}>Anonymous · no login · we only keep what you report</p>
        </div>
      )}
    </main>
  );
}
