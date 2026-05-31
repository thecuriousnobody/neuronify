'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './speak.module.css';

type Phase = 'idle' | 'sending' | 'done';

export default function Speak() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);

  const recognitionRef = useRef<any>(null);
  const usedVoiceRef = useRef(false);

  // Keep a ref of the latest text so the recognition closure can read it.
  const textRef = useRef('');
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    setMicSupported(true);
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    let base = '';
    rec.onstart = () => {
      base = textRef.current ? textRef.current + ' ' : '';
    };
    rec.onresult = (e: any) => {
      let interim = '';
      let finalChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i];
        if (tr.isFinal) finalChunk += tr[0].transcript;
        else interim += tr[0].transcript;
      }
      if (finalChunk) base += finalChunk;
      setText((base + interim).trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const toggleMic = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      rec.stop();
      setListening(false);
    } else {
      setError('');
      usedVoiceRef.current = true;
      try {
        rec.start();
        setListening(true);
      } catch {
        /* already started */
      }
    }
  };

  const submit = async () => {
    const value = text.trim();
    if (!value) {
      setError('Say something about your city first.');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
    }
    setPhase('sending');
    setError('');
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raw_text: value,
          source: usedVoiceRef.current ? 'voice' : 'text',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Something went wrong. Try again.');
        setPhase('idle');
        return;
      }
      setSummary(data?.summary ?? null);
      setPhase('done');
    } catch {
      setError('Network hiccup. Try again.');
      setPhase('idle');
    }
  };

  const reset = () => {
    setText('');
    setSummary(null);
    setError('');
    usedVoiceRef.current = false;
    setPhase('idle');
  };

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
              Signal <span className={styles.it}>received.</span>
            </div>
            {summary && (
              <div className={styles.doneSummary}>
                Heard as: &ldquo;{summary}&rdquo;
              </div>
            )}
            <button className={styles.again} onClick={reset}>
              Add another
            </button>
            <p className={styles.note}>Anonymous · no login · no names stored</p>
          </div>
        </div>
      ) : (
        <div className={styles.inner}>
          <div className={styles.eyebrow}>Speak to Peoria</div>
          <h1 className={styles.prompt}>
            What does your city <span className={styles.it}>need?</span>
          </h1>
          <p className={styles.sub}>
            One thing — a fixed crosswalk, a dark street, a park. Say it or type it.
          </p>

          <textarea
            className={styles.field}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="The crosswalk at Main & Sheridan has no signal and kids cross there every morning…"
            maxLength={2000}
            aria-label="Your message to the city"
          />

          <div className={styles.controls}>
            {micSupported && (
              <button
                type="button"
                className={`${styles.mic} ${listening ? styles.live : ''}`}
                onClick={toggleMic}
                aria-pressed={listening}
              >
                <span className={styles.micDot} />
                {listening ? 'Listening…' : 'Speak'}
              </button>
            )}
            <button
              type="button"
              className={styles.send}
              onClick={submit}
              disabled={phase === 'sending'}
            >
              {phase === 'sending' ? 'Sending your signal…' : 'Send signal →'}
            </button>
          </div>

          {error && <div className={styles.error}>{error}</div>}
          <p className={styles.note}>Anonymous · no login · no names stored</p>
        </div>
      )}
    </main>
  );
}
