'use client';

import { useEffect } from 'react';
import './landing.css';

export default function Landing() {
  useEffect(() => {
    // ── nav scroll state ──
    const nav = document.getElementById('nav');
    const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 20);
    window.addEventListener('scroll', onScroll);

    // ── scroll reveal ──
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.18 },
    );
    document.querySelectorAll<HTMLElement>('.reveal').forEach((el, i) => {
      el.style.transitionDelay = (i % 3) * 80 + 'ms';
      io.observe(el);
    });

    // ── the living neural net ──
    const c = document.getElementById('net') as HTMLCanvasElement | null;
    const x = c?.getContext('2d') ?? null;

    let raf = 0;
    let fireTimer: ReturnType<typeof setInterval> | undefined;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    type Node = { x: number; y: number; vx: number; vy: number; r: number; glow: number };
    type Signal = { a: Node; b: Node; t: number };
    let W = 0;
    let H = 0;
    let nodes: Node[] = [];
    let signals: Signal[] = [];
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const LINK = 160; // px distance to draw a synapse

    function build() {
      const count = Math.round(Math.min(72, Math.max(34, (W * H) / 16000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: Math.random() * 1.6 + 1.1,
        glow: 0,
      }));
    }
    function resize() {
      if (!c) return;
      W = c.clientWidth;
      H = c.clientHeight;
      c.width = W * DPR;
      c.height = H * DPR;
      x!.setTransform(DPR, 0, 0, DPR, 0, 0);
      build();
    }
    function fire() {
      if (nodes.length < 2) return;
      const a = nodes[(Math.random() * nodes.length) | 0];
      let best: Node | null = null;
      let bd = 1e9;
      for (const n of nodes) {
        if (n === a) continue;
        const d = (n.x - a.x) ** 2 + (n.y - a.y) ** 2;
        if (d < bd && d < LINK * LINK) {
          bd = d;
          best = n;
        }
      }
      if (best) signals.push({ a, b: best, t: 0 });
    }
    let last = 0;
    function frame(ts: number) {
      const dt = Math.min(40, ts - last);
      last = ts;
      x!.clearRect(0, 0, W, H);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
        n.glow *= 0.94;
      }
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            const o = (1 - d / LINK) * 0.16;
            x!.strokeStyle = `rgba(120,160,220,${o})`;
            x!.lineWidth = 0.6;
            x!.beginPath();
            x!.moveTo(a.x, a.y);
            x!.lineTo(b.x, b.y);
            x!.stroke();
          }
        }
      for (let i = signals.length - 1; i >= 0; i--) {
        const s = signals[i];
        s.t += dt / 900;
        if (s.t >= 1) {
          s.b.glow = 1;
          signals.splice(i, 1);
          continue;
        }
        const px = s.a.x + (s.b.x - s.a.x) * s.t;
        const py = s.a.y + (s.b.y - s.a.y) * s.t;
        const grad = x!.createLinearGradient(s.a.x, s.a.y, px, py);
        grad.addColorStop(0, 'rgba(56,189,248,0)');
        grad.addColorStop(1, 'rgba(56,189,248,.55)');
        x!.strokeStyle = grad;
        x!.lineWidth = 1.2;
        x!.beginPath();
        x!.moveTo(s.a.x, s.a.y);
        x!.lineTo(px, py);
        x!.stroke();
        x!.beginPath();
        x!.fillStyle = '#bfe9ff';
        x!.shadowColor = '#38BDF8';
        x!.shadowBlur = 14;
        x!.arc(px, py, 2.4, 0, 7);
        x!.fill();
        x!.shadowBlur = 0;
      }
      for (const n of nodes) {
        const g = n.glow;
        x!.beginPath();
        x!.fillStyle = g > 0.02 ? `rgba(143,220,255,${0.5 + g * 0.5})` : 'rgba(150,175,215,.5)';
        if (g > 0.02) {
          x!.shadowColor = '#38BDF8';
          x!.shadowBlur = 18 * g;
        }
        x!.arc(n.x, n.y, n.r + g * 2, 0, 7);
        x!.fill();
        x!.shadowBlur = 0;
      }
      raf = requestAnimationFrame(frame);
    }

    if (c && x) {
      resize();
      window.addEventListener('resize', resize);
      if (!reduce) {
        raf = requestAnimationFrame(frame);
        fireTimer = setInterval(fire, 520);
        for (let i = 0; i < 4; i++) timeouts.push(setTimeout(fire, i * 180));
      } else {
        frame(0);
      }
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', resize);
      io.disconnect();
      cancelAnimationFrame(raf);
      if (fireTimer) clearInterval(fireTimer);
      timeouts.forEach(clearTimeout);
    };
  }, []);

  const join = async () => {
    const input = document.getElementById('email') as HTMLInputElement | null;
    const t = document.getElementById('thanks');
    const btn = document.getElementById('joinBtn') as HTMLButtonElement | null;
    if (!input || !t) return;
    const v = input.value.trim();
    if (!v || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      t.textContent = 'ENTER A VALID SIGNAL ADDRESS';
      t.style.opacity = '1';
      t.style.color = '#ff8a5c';
      return;
    }
    t.textContent = 'SENDING…';
    t.style.color = 'var(--muted)';
    t.style.opacity = '1';
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: v }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        t.textContent = (d?.error || 'Something went wrong — try again').toUpperCase();
        t.style.color = '#ff8a5c';
      } else {
        t.textContent = "SIGNAL RECEIVED — we'll be in touch.";
        t.style.color = 'var(--cyan-bright)';
        input.value = '';
      }
    } catch {
      t.textContent = 'NETWORK HICCUP — TRY AGAIN';
      t.style.color = '#ff8a5c';
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  return (
    <>
      <nav id="nav">
        <div className="wrap nav-inner">
          <div className="logo">
            <span className="dot" />
            Neuronify
          </div>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#brief">The brief</a>
            <a href="/speak">Speak</a>
            <a href="/wall">Live wall</a>
            <a href="#join" className="btn-ghost">
              Early access
            </a>
          </div>
        </div>
      </nav>

      <header className="hero">
        <canvas id="net" />
        <div className="wrap hero-content">
          <div className="eyebrow">Your city&apos;s nervous system</div>
          <h1>
            <span className="l1">Every resident,</span>
            <span className="l2">
              a <span className="it">neuron.</span>
            </span>
          </h1>
          <p className="lede">
            Neuronify turns what your city is saying into a ranked, <b>costed</b> plan its leaders
            can actually act on. Speak up — and watch the signal travel.
          </p>
          <div className="cta-row">
            <a href="/speak" className="btn btn-primary">
              Speak up <span className="arrow">→</span>
            </a>
            <a href="#how" className="btn-text">
              See how it works
            </a>
          </div>
        </div>
      </header>

      <section id="how" className="pad">
        <div className="wrap">
          <div className="sec-eyebrow reveal">From voice to plan</div>
          <h2 className="sec-title reveal">
            Three steps from a <span className="it">spoken word</span> to a plan on the
            council&apos;s desk.
          </h2>
          <div className="steps">
            <div className="step reveal">
              <div className="num">01 / SPEAK</div>
              <div className="node" />
              <h3>Speak</h3>
              <p>
                Walk up to a kiosk or scan a code. Say what your city needs — a fixed crosswalk,
                more parks, support for a local business. No forms. No login. Just your voice.
              </p>
            </div>
            <div className="step reveal">
              <div className="num">02 / TRIAGE</div>
              <div className="node" />
              <h3>Triage</h3>
              <p>
                Neuronify reads every signal, sorts it by urgency, names the real fix — then
                estimates what it would cost, grounded in real municipal numbers.
              </p>
            </div>
            <div className="step reveal">
              <div className="num">03 / BRIEF</div>
              <div className="node" />
              <h3>Brief</h3>
              <p>
                It all becomes one ranked, costed page for the council and the mayor. Community
                signal in. A plan they can act on, out.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="brief" className="pad">
        <div className="wrap">
          <div className="brief-grid">
            <div className="brief-copy reveal">
              <div className="sec-eyebrow">The output</div>
              <h2 className="sec-title">
                A page City Hall can read in <span className="it">two minutes.</span>
              </h2>
              <p>
                Most civic feedback dies in an inbox. Neuronify ends every session with something a
                council member can actually use — issues ranked by how many residents raised them
                and how urgent they are, each with a real fix and a real cost range.
              </p>
              <p className="pull">&ldquo;Community signal in. A costed plan out.&rdquo;</p>
            </div>
            <div className="console reveal">
              <div className="console-bar">
                <span className="d" />
                <span className="d" />
                <span className="d" />
                <span>PEORIA · SESSION BRIEF</span>
              </div>
              <div className="console-body">
                <div className="row">
                  <span className="cat">
                    <span className="sev h" />
                    SIDEWALKS &amp; ADA
                  </span>
                  <span className="meta">14 residents · HIGH</span>
                  <span className="cost">$48K–72K</span>
                </div>
                <div className="row">
                  <span className="cat">
                    <span className="sev m" />
                    STREET LIGHTING
                  </span>
                  <span className="meta">9 residents · MED</span>
                  <span className="cost">$21K–36K</span>
                </div>
                <div className="row">
                  <span className="cat">
                    <span className="sev m" />
                    PARKS &amp; REC
                  </span>
                  <span className="meta">23 residents · MED</span>
                  <span className="cost">$55K–140K</span>
                </div>
                <div className="total">
                  <span className="cat">46 RESIDENTS · TOTAL SIGNAL</span>
                  <span className="cost">$124K–248K</span>
                </div>
              </div>
            </div>
          </div>
          <p className="disclaimer">
            ↳ Planning-level illustration sourced from community input — not a verified engineering
            quote.
          </p>
        </div>
      </section>

      <section className="origin">
        <div className="wrap">
          <div className="big reveal">
            Born in Peoria. Built live, in <span className="it">the open.</span>
          </div>
          <div className="sub reveal">
            Pure Illinois — where we&apos;d rather build the thing than slideshow about it
          </div>
        </div>
      </section>

      <section id="join" className="final">
        <div className="wrap">
          <h2 className="reveal">
            Neuronify <span className="it">your city.</span>
          </h2>
          <p className="join-sub reveal">
            Want this for your city, or to follow where it goes next? Leave your email and
            we&apos;ll reach out.
          </p>
          <div className="signup reveal">
            <input id="email" type="email" placeholder="your@email.com" aria-label="Email" />
            <button id="joinBtn" className="btn btn-primary" onClick={join}>
              Request access <span className="arrow">→</span>
            </button>
          </div>
          <div id="thanks">SIGNAL RECEIVED — we&apos;ll be in touch.</div>
        </div>
      </section>

      <footer>
        <div className="wrap footer-inner">
          <div className="footer-brand">
            <div className="f-logo">
              <span className="dot" />
              Neuronify
            </div>
            <div className="meta">neuronify.ai · Peoria, Illinois</div>
          </div>
          <div className="footer-nav">
            <div className="footer-col">
              <div className="footer-h">Participate</div>
              <a href="/speak">Speak</a>
              <a href="/wall">Live wall</a>
              <a href="/brief/66df1af1-4d80-4115-a042-5ad41170f730">Sample brief</a>
            </div>
            <div className="footer-col">
              <div className="footer-h">Operate</div>
              <a href="/admin">Admin</a>
              <a href="/qr">QR poster</a>
            </div>
            <div className="footer-col">
              <div className="footer-h">Explore</div>
              <a href="/preview">All screens</a>
              <a href="#how">How it works</a>
              <a href="#brief">The brief</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
