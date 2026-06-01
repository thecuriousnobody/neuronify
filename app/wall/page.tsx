'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './wall.module.css';

type FeedItem = {
  id: string;
  created_at: string;
  source: string;
  status: string;
  summary: string | null;
  category: string | null;
  severity: string | null;
  cost_low_usd: number | null;
  cost_high_usd: number | null;
};

const POLL_MS = 1200;

function sevClass(sev: string | null): string {
  switch (sev) {
    case 'safety_critical':
      return styles.sevCrit;
    case 'high':
      return styles.sevHigh;
    case 'medium':
      return styles.sevMed;
    default:
      return styles.sevLow;
  }
}

function money(low: number | null, high: number | null): string {
  if (low == null || high == null) return '';
  const fmt = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`);
  return `${fmt(low)}–${fmt(high)}`;
}

export default function Wall() {
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [count, setCount] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [cityLabel, setCityLabel] = useState('Peoria, Illinois');
  const [citySlug, setCitySlug] = useState('');

  const seenRef = useRef<Set<string>>(new Set());
  const fireRef = useRef<(n?: number) => void>(() => {});

  // ── poll the feed ──
  useEffect(() => {
    let active = true;
    const slug = new URLSearchParams(window.location.search).get('city') || '';
    setCitySlug(slug);
    const tick = async () => {
      try {
        const res = await fetch(`/api/feed${slug ? `?city=${encodeURIComponent(slug)}` : ''}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        if (data.sessionId) setSessionId(data.sessionId);
        if (data.cityShort) setCityLabel(`${data.cityShort}, Illinois`);

        const subs: FeedItem[] = data.submissions ?? [];
        // Fire the canvas only for genuinely new ids.
        const fresh = subs.filter((s) => !seenRef.current.has(s.id));
        if (fresh.length) {
          fresh.forEach((s) => seenRef.current.add(s.id));
          fireRef.current(Math.min(fresh.length, 5));
        }
        // Always re-render from the latest feed so pending→triaged updates.
        setCount(typeof data.count === 'number' ? data.count : subs.length);
        setItems(subs.slice().reverse().slice(0, 50));
      } catch {
        /* keep polling */
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // ── neural canvas with a fire() burst per incoming signal ──
  useEffect(() => {
    const c = document.getElementById('wallnet') as HTMLCanvasElement | null;
    const x = c?.getContext('2d') ?? null;
    if (!c || !x) return;

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const LINK = 170;
    type Node = { x: number; y: number; vx: number; vy: number; r: number; glow: number };
    type Signal = { a: Node; b: Node; t: number };
    let W = 0;
    let H = 0;
    let nodes: Node[] = [];
    let signals: Signal[] = [];
    let raf = 0;

    const build = () => {
      const count = Math.round(Math.min(110, Math.max(48, (W * H) / 14000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        r: Math.random() * 1.6 + 1.1,
        glow: 0,
      }));
    };
    const resize = () => {
      W = c.clientWidth;
      H = c.clientHeight;
      c.width = W * DPR;
      c.height = H * DPR;
      x.setTransform(DPR, 0, 0, DPR, 0, 0);
      build();
    };

    const fire = (n = 1) => {
      if (nodes.length < 2) return;
      for (let k = 0; k < n; k++) {
        const a = nodes[(Math.random() * nodes.length) | 0];
        let best: Node | null = null;
        let bd = 1e9;
        for (const node of nodes) {
          if (node === a) continue;
          const d = (node.x - a.x) ** 2 + (node.y - a.y) ** 2;
          if (d < bd && d < LINK * LINK) {
            bd = d;
            best = node;
          }
        }
        a.glow = 1;
        if (best) signals.push({ a, b: best, t: 0 });
      }
    };
    fireRef.current = fire;

    let last = 0;
    const frame = (ts: number) => {
      const dt = Math.min(40, ts - last);
      last = ts;
      x.clearRect(0, 0, W, H);
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
        n.glow *= 0.95;
      }
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            const o = (1 - d / LINK) * 0.15;
            x.strokeStyle = `rgba(120,160,220,${o})`;
            x.lineWidth = 0.6;
            x.beginPath();
            x.moveTo(a.x, a.y);
            x.lineTo(b.x, b.y);
            x.stroke();
          }
        }
      for (let i = signals.length - 1; i >= 0; i--) {
        const s = signals[i];
        s.t += dt / 850;
        if (s.t >= 1) {
          s.b.glow = 1;
          signals.splice(i, 1);
          continue;
        }
        const px = s.a.x + (s.b.x - s.a.x) * s.t;
        const py = s.a.y + (s.b.y - s.a.y) * s.t;
        const grad = x.createLinearGradient(s.a.x, s.a.y, px, py);
        grad.addColorStop(0, 'rgba(56,189,248,0)');
        grad.addColorStop(1, 'rgba(56,189,248,.6)');
        x.strokeStyle = grad;
        x.lineWidth = 1.3;
        x.beginPath();
        x.moveTo(s.a.x, s.a.y);
        x.lineTo(px, py);
        x.stroke();
        x.beginPath();
        x.fillStyle = '#cdeeff';
        x.shadowColor = '#38BDF8';
        x.shadowBlur = 16;
        x.arc(px, py, 2.6, 0, 7);
        x.fill();
        x.shadowBlur = 0;
      }
      for (const n of nodes) {
        const g = n.glow;
        x.beginPath();
        x.fillStyle = g > 0.02 ? `rgba(143,220,255,${0.5 + g * 0.5})` : 'rgba(150,175,215,.45)';
        if (g > 0.02) {
          x.shadowColor = '#38BDF8';
          x.shadowBlur = 20 * g;
        }
        x.arc(n.x, n.y, n.r + g * 2.4, 0, 7);
        x.fill();
        x.shadowBlur = 0;
      }
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener('resize', resize);
    if (reduce) {
      frame(0);
    } else {
      raf = requestAnimationFrame(frame);
    }
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
      fireRef.current = () => {};
    };
  }, []);

  const generateBrief = async () => {
    if (!sessionId) return;
    setGenerating(true);
    router.push(`/brief/${sessionId}`);
  };

  return (
    <div className={styles.wall}>
      <canvas id="wallnet" className={styles.canvas} />
      <div className={styles.vignette} />

      <div className={styles.stage}>
        <div className={styles.brand}>
            <span className={styles.brandDot} />
            Neuronify
          </div>

          <div className={styles.hero}>
            <div className={styles.headline}>
            <div className={styles.eyebrow}>Live · the city is firing</div>
            <div className={styles.count}>
              <span className={styles.countNum}>{count}</span>
              <span className={styles.countLabel}>
                residents <span className={styles.it}>spoke.</span>
              </span>
            </div>
            <div className={styles.city}>{cityLabel}</div>
          </div>

          <div className={styles.ops}>
            <button
              className={styles.brief}
              onClick={generateBrief}
              disabled={!sessionId || generating || count === 0}
            >
              {generating ? 'Generating…' : 'Generate brief →'}
            </button>
            <div className={styles.qr}>
              Speak at <b>neuronify.ai/speak{citySlug ? `?city=${citySlug}` : ''}</b>
            </div>
          </div>
        </div>

        <div className={styles.feed}>
          <div className={styles.feedHead}>
            <span>Incoming signal</span>
            <span className={styles.feedLive}>
              <span className={styles.feedLiveDot} />
              Live
            </span>
          </div>
          <div className={styles.feedList}>
            {items.length === 0 && (
              <div className={styles.empty}>
                Waiting for the first signal…
                <br />
                Scan the code and speak.
              </div>
            )}
            {items.map((it) => (
              <div className={styles.item} key={it.id}>
                {it.status === 'triaged' && it.summary ? (
                  <>
                    <div className={styles.itemSummary}>{it.summary}</div>
                    <div className={styles.itemMeta}>
                      <span className={`${styles.sev} ${sevClass(it.severity)}`} />
                      <span className={styles.itemCat}>
                        {(it.category ?? 'other').replace(/_/g, ' ')}
                      </span>
                      {money(it.cost_low_usd, it.cost_high_usd) && (
                        <span className={styles.itemCost}>
                          {money(it.cost_low_usd, it.cost_high_usd)}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className={styles.itemPending}>New signal arriving…</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
