'use client';

import { useEffect } from 'react';

// The living neural net behind the gallery + scroll-reveal — same soul as the
// landing page, lighter (the tiles are also live iframes).
export default function Backdrop() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12 },
    );
    document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el, i) => {
      el.style.transitionDelay = (i % 4) * 70 + 'ms';
      io.observe(el);
    });

    const c = document.getElementById('prevnet') as HTMLCanvasElement | null;
    const x = c?.getContext('2d') ?? null;
    if (!c || !x) return () => io.disconnect();

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const LINK = 150;
    type N = { x: number; y: number; vx: number; vy: number; r: number; glow: number };
    let W = 0;
    let H = 0;
    let nodes: N[] = [];
    let signals: { a: N; b: N; t: number }[] = [];
    let raf = 0;
    let fire: ReturnType<typeof setInterval> | undefined;
    let last = 0;

    const build = () => {
      const n = Math.round(Math.min(60, Math.max(28, (W * H) / 22000)));
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.13,
        vy: (Math.random() - 0.5) * 0.13,
        r: Math.random() * 1.5 + 1,
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
    const spark = () => {
      if (nodes.length < 2) return;
      const a = nodes[(Math.random() * nodes.length) | 0];
      let b: N | null = null;
      let bd = 1e9;
      for (const n of nodes) {
        if (n === a) continue;
        const d = (n.x - a.x) ** 2 + (n.y - a.y) ** 2;
        if (d < bd && d < LINK * LINK) {
          bd = d;
          b = n;
        }
      }
      a.glow = 1;
      if (b) signals.push({ a, b, t: 0 });
    };
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
            const o = (1 - d / LINK) * 0.12;
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
        s.t += dt / 900;
        if (s.t >= 1) {
          s.b.glow = 1;
          signals.splice(i, 1);
          continue;
        }
        const px = s.a.x + (s.b.x - s.a.x) * s.t;
        const py = s.a.y + (s.b.y - s.a.y) * s.t;
        const g = x.createLinearGradient(s.a.x, s.a.y, px, py);
        g.addColorStop(0, 'rgba(56,189,248,0)');
        g.addColorStop(1, 'rgba(56,189,248,.5)');
        x.strokeStyle = g;
        x.lineWidth = 1.1;
        x.beginPath();
        x.moveTo(s.a.x, s.a.y);
        x.lineTo(px, py);
        x.stroke();
        x.beginPath();
        x.fillStyle = '#bfe9ff';
        x.shadowColor = '#38BDF8';
        x.shadowBlur = 12;
        x.arc(px, py, 2, 0, 7);
        x.fill();
        x.shadowBlur = 0;
      }
      for (const n of nodes) {
        const g = n.glow;
        x.beginPath();
        x.fillStyle = g > 0.02 ? `rgba(143,220,255,${0.45 + g * 0.5})` : 'rgba(150,175,215,.4)';
        if (g > 0.02) {
          x.shadowColor = '#38BDF8';
          x.shadowBlur = 16 * g;
        }
        x.arc(n.x, n.y, n.r + g * 1.8, 0, 7);
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
      fire = setInterval(spark, 650);
    }
    return () => {
      io.disconnect();
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
      if (fire) clearInterval(fire);
    };
  }, []);

  return null;
}
