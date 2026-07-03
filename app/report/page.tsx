'use client';

// The resident's voice door (v2). Tap the mic, speak, and Deepgram transcribes.
// The resident reviews what was heard and sends it to the city — which parks it
// as a pending intake for a staffer to digest and confirm. Frictionless and
// anonymous, matching the "just click a microphone" product vision.

import { useEffect, useRef, useState } from 'react';
import { resolveCity, type City } from '@/lib/cities';
import styles from './report.module.css';

type Phase = 'idle' | 'transcribing' | 'previewing' | 'preview' | 'sending' | 'done';
type Understood = {
  key: string;
  label: string;
  type: string;
  choices: string[] | null;
  value: unknown;
  missing: boolean;
};
type GeoMatch = { matched: string; lat: number; lon: number };
type Preview = {
  understood: Understood[];
  locationMatch: GeoMatch | null;
  category: string;
  severity: string;
  department: string;
};

const SEV_LABEL: Record<string, string> = {
  safety_critical: 'Safety-critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Tap-to-answer chips for a missing field: Yes/No for booleans, the choices for
 *  choice fields, and a short inline input for locations/free text. */
function GapFiller({ field, onAnswer }: { field: Understood; onAnswer: (label: string, answer: string) => void }) {
  const [custom, setCustom] = useState('');
  const chips =
    field.type === 'boolean' ? ['Yes', 'No'] : field.choices && field.choices.length ? field.choices : null;

  if (chips) {
    return (
      <div className={styles.chips}>
        {chips.map((c) => (
          <button key={c} type="button" className={styles.chip} onClick={() => onAnswer(field.label, c)}>
            {c}
          </button>
        ))}
      </div>
    );
  }
  return (
    <form
      className={styles.gapForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (custom.trim()) onAnswer(field.label, custom.trim());
      }}
    >
      <input
        className={styles.gapInput}
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        placeholder={field.type === 'location' ? 'e.g. Knoxville Ave & Giles Ave' : 'Add it here…'}
        aria-label={field.label}
      />
      <button type="submit" className={styles.chip} disabled={!custom.trim()}>
        Add
      </button>
    </form>
  );
}

/** The honest map line under a filled location. A confident match shows the
 *  normalized address + a "not right?" escape hatch; a failed match says so
 *  plainly and asks for a cross-street instead of asserting a wrong pin. */
function LocationCheck({
  field,
  match,
  onAnswer,
}: {
  field: Understood;
  match: GeoMatch | null;
  onAnswer: (label: string, answer: string) => void;
}) {
  const [fixing, setFixing] = useState(false);

  if (fixing || !match) {
    return (
      <div className={styles.locFix}>
        {!match && !fixing && (
          <div className={styles.matchMiss}>
            <span className={styles.matchPin}>◎</span> couldn’t pin this on the map — a street or cross-street helps
          </div>
        )}
        <GapFiller field={field} onAnswer={onAnswer} />
      </div>
    );
  }
  return (
    <div className={styles.matchLine}>
      <span className={styles.matchPin}>◎</span>
      <span>
        ≈ {match.matched}{' '}
        <a
          className={styles.matchLink}
          href={`https://www.openstreetmap.org/?mlat=${match.lat}&mlon=${match.lon}#map=17/${match.lat}/${match.lon}`}
          target="_blank"
          rel="noreferrer"
        >
          map ↗
        </a>{' '}
        <button type="button" className={styles.fixLink} onClick={() => setFixing(true)}>
          not right?
        </button>
      </span>
    </div>
  );
}

export default function Report() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; createdAt: string } | null>(null);
  const [city, setCity] = useState<City>(() => resolveCity(null));

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const usedVoiceRef = useRef(false);

  // Mirrors for use inside recorder callbacks (which close over stale state).
  const textRef = useRef('');
  const previewRef = useRef<Preview | null>(null);
  useEffect(() => { textRef.current = text; }, [text]);
  useEffect(() => { previewRef.current = preview; }, [preview]);

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
        setPhase('idle');
      } else {
        const t = String(data?.transcript ?? '').trim();
        const next = textRef.current ? `${textRef.current} ${t}` : t;
        setText(next);
        // If the "what we understood" card was showing, the resident is
        // CORRECTING it — re-digest with the new words instead of going stale.
        if (previewRef.current && t) {
          setPreview(null);
          review(next); // review() sets phase itself
        } else {
          setPhase('idle');
        }
      }
    } catch {
      setError('Network hiccup during transcription.');
      setPhase('idle');
    }
  }

  async function review(override?: string) {
    const value = (override ?? text).trim();
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
      setReceipt({ id: String(data.id ?? ''), createdAt: String(data.createdAt ?? '') });
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
    setReceipt(null);
    usedVoiceRef.current = false;
    setPhase('idle');
  }

  function editAgain() {
    setPreview(null);
    setPhase('idle');
  }

  // Answer a gap with a tap (or a short inline input). The answer is appended to
  // the transcript as a clean Q/A line — the transcript stays the single source
  // of truth (staff digest re-reads it) — then the understanding re-checks.
  function answerGap(label: string, answer: string) {
    const addition = `\nQ: ${label} A: ${answer}`;
    const next = `${text.trim()}${addition}`;
    setText(next);
    setPreview(null);
    review(next);
  }

  return (
    <main className={styles.shell}>
      <div className={styles.glow} />
      <a href="/" className={styles.brand}>
        <span className={styles.brandDot} />
        Neuronify
      </a>
      <a href="/desk/intake" className={styles.staffLink}>City staff? Intake console →</a>

      {phase === 'done' ? (
        <div className={styles.inner}>
          <div className={styles.done}>
            <div className={styles.doneNode} />
            <div className={styles.doneTitle}>
              We’ve got it, <span className={styles.it}>thank you.</span>
            </div>
            {/* The OFFICIAL record — what the city receives, not the raw transcript. */}
            {preview ? (
              <div className={`${styles.understood} ${styles.doneCard}`}>
                <div className={styles.understoodHead}>
                  <span className={styles.understoodEyebrow}>Your report — as sent</span>
                  <span className={`${styles.sevChip} ${styles[`sev_${preview.severity}`] ?? ''}`}>
                    {SEV_LABEL[preview.severity] ?? preview.severity}
                  </span>
                </div>
                <div className={styles.understoodCat}>
                  {pretty(preview.category)} · routed to {pretty(preview.department)}
                </div>
                <ul className={styles.understoodList}>
                  {preview.understood.map((u) => (
                    <li key={u.key} className={styles.understoodItem}>
                      <div className={styles.understoodRow}>
                        <span className={styles.uLabel}>{u.label}</span>
                        {u.missing ? (
                          <span className={styles.uMissing}>not provided</span>
                        ) : (
                          <span className={styles.uValue}>{u.value === true ? 'Yes' : u.value === false ? 'No' : String(u.value)}</span>
                        )}
                      </div>
                      {!u.missing && u.type === 'location' && preview.locationMatch && (
                        <div className={styles.matchLine}>
                          <span className={styles.matchPin}>◎</span>
                          <span>
                            ≈ {preview.locationMatch.matched}{' '}
                            <a
                              className={styles.matchLink}
                              href={`https://www.openstreetmap.org/?mlat=${preview.locationMatch.lat}&mlon=${preview.locationMatch.lon}#map=17/${preview.locationMatch.lat}/${preview.locationMatch.lon}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              map ↗
                            </a>
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className={styles.doneSummary}>“{text}”</div>
            )}
            {receipt && (
              <div className={styles.receiptLine}>
                Received {receipt.createdAt ? new Date(receipt.createdAt).toLocaleString() : 'just now'} · Ref{' '}
                <code>{receipt.id.slice(0, 8).toUpperCase()}</code>
              </div>
            )}
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
                    <li key={u.key} className={styles.understoodItem}>
                      <div className={styles.understoodRow}>
                        <span className={styles.uLabel}>{u.label}</span>
                        {u.missing ? (
                          <span className={styles.uMissing}>we didn’t catch this</span>
                        ) : (
                          <span className={styles.uValue}>{u.value === true ? 'Yes' : u.value === false ? 'No' : String(u.value)}</span>
                        )}
                      </div>
                      {u.missing && <GapFiller field={u} onAnswer={answerGap} />}
                      {!u.missing && u.type === 'location' && (
                        <LocationCheck field={u} match={preview.locationMatch} onAnswer={answerGap} />
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
            <button type="button" className={styles.send} onClick={() => review()} disabled={phase === 'transcribing' || phase === 'previewing'}>
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
