'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const COLOR_HEX: Record<string, string> = {
  '--c1': '#38BDF8',
  '--c2': '#8B7FD4',
  '--c3': '#FF8A5C',
  '--c4': '#34D399',
  '--c5': '#FBBF24',
};
const rc = (v: string) => COLOR_HEX[v] ?? '#8a8a8a';
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

type MCluster = { id: string; name: string; color: string };
type MIdea = { id: string; cluster_id: string | null; parent_id: string | null; text: string };

type SimNode = {
  id: string;
  kind: 'center' | 'cluster' | 'idea';
  label: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
  floatPhase: number; // unique phase for sinusoidal drift
  floatFreq: number;  // unique frequency for sinusoidal drift
};

type SimLink = {
  from: string;
  to: string;
  color: string;
  branch: boolean;
  idealLen: number;
  curveSeed: number;
};

const VW = 1200,
  VH = 900;
const REPULSION = 13000;
const DAMPING = 0.92;
const CENTER_PULL = 0.003;
const FLOAT_AMP = 0.09; // sinusoidal drift amplitude — smooth, not random

function strHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0; // unsigned
}

function buildSim(clusters: MCluster[], ideas: MIdea[], name: string) {
  const childMap = new Map<string, string[]>();
  const colorOf = new Map<string, string>();
  const labelOf = new Map<string, string>();
  const kindOf = new Map<string, SimNode['kind']>();

  childMap.set('_', []);
  colorOf.set('_', '#38BDF8');
  labelOf.set('_', name);
  kindOf.set('_', 'center');

  clusters.forEach((c) => {
    const cid = `c_${c.id}`;
    childMap.set(cid, []);
    colorOf.set(cid, rc(c.color));
    labelOf.set(cid, c.name);
    kindOf.set(cid, 'cluster');
    childMap.get('_')!.push(cid);
  });

  ideas.forEach((idea) => {
    const iid = `i_${idea.id}`;
    childMap.set(iid, []);
    const clust = idea.cluster_id ? clusters.find((c) => c.id === idea.cluster_id) : null;
    colorOf.set(iid, clust ? rc(clust.color) : '#888888');
    labelOf.set(iid, idea.text);
    kindOf.set(iid, 'idea');
  });

  // Two-pass wiring: every idea gets a node and an edge
  ideas.forEach((idea) => {
    const iid = `i_${idea.id}`;
    if (idea.parent_id && childMap.has(`i_${idea.parent_id}`)) {
      childMap.get(`i_${idea.parent_id}`)!.push(iid);
    } else if (idea.cluster_id && childMap.has(`c_${idea.cluster_id}`)) {
      childMap.get(`c_${idea.cluster_id}`)!.push(iid);
    } else {
      childMap.get('_')!.push(iid);
    }
  });

  const nodes: SimNode[] = [];
  for (const [id] of childMap) {
    const kind = kindOf.get(id) ?? 'idea';
    const angle = Math.random() * Math.PI * 2;
    const r =
      kind === 'center' ? 0 : kind === 'cluster' ? 180 + Math.random() * 100 : 270 + Math.random() * 160;
    nodes.push({
      id,
      kind,
      label: labelOf.get(id) ?? '',
      color: colorOf.get(id) ?? '#888',
      x: VW / 2 + Math.cos(angle) * r,
      y: VH / 2 + Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      fixed: id === '_',
      floatPhase: ((strHash(id) % 1000) / 1000) * Math.PI * 2,
      floatFreq: 0.007 + ((strHash(id + 'f') % 100) / 100) * 0.006,
    });
  }

  // Center fixed
  const center = nodes.find((n) => n.id === '_')!;
  center.x = VW / 2;
  center.y = VH / 2;

  const links: SimLink[] = [];
  clusters.forEach((c) => {
    links.push({
      from: '_',
      to: `c_${c.id}`,
      color: rc(c.color),
      branch: false,
      idealLen: 220,
      curveSeed: strHash(`_c_${c.id}`),
    });
  });
  ideas.forEach((idea) => {
    const iid = `i_${idea.id}`;
    let parentId: string;
    if (idea.parent_id && childMap.has(`i_${idea.parent_id}`)) {
      parentId = `i_${idea.parent_id}`;
    } else if (idea.cluster_id && childMap.has(`c_${idea.cluster_id}`)) {
      parentId = `c_${idea.cluster_id}`;
    } else {
      parentId = '_';
    }
    links.push({
      from: parentId,
      to: iid,
      color: colorOf.get(iid) ?? '#888',
      branch: !!idea.parent_id,
      idealLen: parentId === '_' ? 220 : parentId.startsWith('c_') ? 160 : 115,
      curveSeed: strHash(`${parentId}${iid}`),
    });
  });

  return { nodes, links };
}

// Organic bezier curve: control point offset perpendicular to the midpoint
function organicPath(x1: number, y1: number, x2: number, y2: number, seed: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1,
    dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len,
    ny = dx / len;
  const offset = ((seed % 255) / 255 - 0.5) * 90;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} Q${(mx + nx * offset).toFixed(1)},${(my + ny * offset).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

function nodeRadius(kind: SimNode['kind']) {
  return kind === 'center' ? 40 : kind === 'cluster' ? 26 : 16;
}

type Props = { clusters: MCluster[]; ideas: MIdea[]; sessionName: string };

export default function MindMap({ clusters, ideas, sessionName }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const [, setTick] = useState(0);
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });

  // Rebuild sim when data changes; preserve positions of existing nodes
  useEffect(() => {
    const { nodes: newNodes, links } = buildSim(clusters, ideas, sessionName);
    const oldMap = new Map(nodesRef.current.map((n) => [n.id, n]));
    for (const node of newNodes) {
      const old = oldMap.get(node.id);
      if (old) {
        node.x = old.x;
        node.y = old.y;
        node.vx = old.vx;
        node.vy = old.vy;
        // preserve float phase so drift doesn't reset on new ideas
        node.floatPhase = old.floatPhase;
        node.floatFreq = old.floatFreq;
      }
    }
    nodesRef.current = newNodes;
    linksRef.current = links;
  }, [clusters, ideas, sessionName]);

  // Persistent physics loop — runs for the lifetime of the component
  useEffect(() => {
    let frameCount = 0;

    function tick() {
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // Coulomb repulsion between all pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i],
            b = nodes[j];
          const dx = a.x - b.x,
            dy = a.y - b.y;
          const dist2 = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(dist2);
          const f = REPULSION / (dist2 * dist);
          if (!a.fixed) {
            a.vx += dx * f;
            a.vy += dy * f;
          }
          if (!b.fixed) {
            b.vx -= dx * f;
            b.vy -= dy * f;
          }
        }
      }

      // Spring attraction along edges
      for (const link of links) {
        const a = nodeMap.get(link.from),
          b = nodeMap.get(link.to);
        if (!a || !b) continue;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (dist - link.idealLen) * 0.032;
        const fx = (dx / dist) * f,
          fy = (dy / dist) * f;
        if (!a.fixed) {
          a.vx += fx;
          a.vy += fy;
        }
        if (!b.fixed) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // Integrate: gravity + noise + damping
      for (const node of nodes) {
        if (node.fixed) continue;
        node.vx += (VW / 2 - node.x) * CENTER_PULL;
        node.vy += (VH / 2 - node.y) * CENTER_PULL;
        // Smooth sinusoidal drift — each node has its own phase/freq, no randomness
        node.vx += Math.sin(frameCount * node.floatFreq + node.floatPhase) * FLOAT_AMP;
        node.vy += Math.cos(frameCount * node.floatFreq * 1.37 + node.floatPhase + 1.7) * FLOAT_AMP;
        node.vx *= DAMPING;
        node.vy *= DAMPING;
        node.x += node.vx;
        node.y += node.vy;
      }

      // Re-render at ~30 fps
      frameCount++;
      if (frameCount % 2 === 0) setTick((t) => t + 1);

      requestAnimationFrame(tick);
    }

    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []); // reads mutable refs — no deps needed

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * VW;
    const my = ((e.clientY - rect.top) / rect.height) * VH;
    setView((v) => {
      const gx = (mx - v.tx) / v.k,
        gy = (my - v.ty) / v.k;
      const delta = e.deltaMode === 0 ? e.deltaY : e.deltaY * 30;
      const newK = Math.max(0.2, Math.min(5, v.k * Math.pow(0.999, delta)));
      return { tx: mx - gx * newK, ty: my - gy * newK, k: newK };
    });
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  function startPan(e: React.MouseEvent) {
    if (!(e.target as Element).classList.contains('mm-bg')) return;
    isPanning.current = true;
    panStart.current = { mx: e.clientX, my: e.clientY, tx: view.tx, ty: view.ty };
  }

  function movePan(e: React.MouseEvent) {
    if (!isPanning.current) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = VW / rect.width,
      sy = VH / rect.height;
    setView((v) => ({
      ...v,
      tx: panStart.current.tx + (e.clientX - panStart.current.mx) * sx,
      ty: panStart.current.ty + (e.clientY - panStart.current.my) * sy,
    }));
  }

  // Snapshot refs for render
  const nodes = nodesRef.current;
  const links = linksRef.current;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const connectedIds = hoverId
    ? (() => {
        const s = new Set<string>([hoverId]);
        for (const l of links) {
          if (l.from === hoverId) s.add(l.to);
          if (l.to === hoverId) s.add(l.from);
        }
        return s;
      })()
    : null;

  const isEmpty = clusters.length === 0 && ideas.length === 0;

  return (
    <div className="mindmap-wrap">
      <svg
        ref={svgRef}
        className="mindmap-svg"
        viewBox={`0 0 ${VW} ${VH}`}
        onMouseDown={startPan}
        onMouseMove={movePan}
        onMouseUp={() => { isPanning.current = false; }}
        onMouseLeave={() => { isPanning.current = false; }}
      >
        <defs>
          <filter id="glow-sm" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-lg" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-dot" x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
          <rect
            className="mm-bg"
            x={-50000}
            y={-50000}
            width={200000}
            height={200000}
            fill="transparent"
          />

          {/* Axons */}
          {links.map((l, i) => {
            const a = nodeMap.get(l.from),
              b = nodeMap.get(l.to);
            if (!a || !b) return null;
            const pathD = organicPath(a.x, a.y, b.x, b.y, l.curveSeed);
            const active =
              !connectedIds || (connectedIds.has(l.from) && connectedIds.has(l.to));
            const pulseDur = `${2.0 + (i % 7) * 0.45}s`;
            return (
              <g key={`lk-${i}`} opacity={active ? 1 : 0.04} style={{ transition: 'opacity 0.2s' }}>
                <path
                  id={`lp-${i}`}
                  d={pathD}
                  stroke={l.color}
                  strokeWidth={l.branch ? 1 : 1.8}
                  strokeDasharray={l.branch ? '6 5' : undefined}
                  fill="none"
                  strokeOpacity={0.45}
                />
                {/* Signal pulse traveling along axon */}
                <circle r={2.8} fill={l.color} filter="url(#glow-dot)" opacity={0.8}>
                  <animateMotion dur={pulseDur} repeatCount="indefinite">
                    <mpath href={`#lp-${i}`} />
                  </animateMotion>
                </circle>
              </g>
            );
          })}

          {/* Soma (cell bodies) */}
          {nodes.map((n) => {
            const r = nodeRadius(n.kind);
            const isCenter = n.kind === 'center';
            const isHov = hoverId === n.id;
            const dimmed = connectedIds ? !connectedIds.has(n.id) : false;
            const pulseDur = `${isCenter ? 2.6 : 3.2 + (strHash(n.id) % 24) * 0.12}s`;

            return (
              <g
                key={n.id}
                transform={`translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`}
                opacity={dimmed ? 0.08 : 1}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                style={{ transition: 'opacity 0.2s', cursor: 'default' }}
              >
                {/* Pulsing halo */}
                <circle
                  fill="none"
                  stroke={n.color}
                  strokeWidth={1}
                  r={r + 5}
                  opacity={isHov ? 0.65 : 0.2}
                  filter="url(#glow-sm)"
                >
                  <animate
                    attributeName="r"
                    values={`${r + 4};${r + (isCenter ? 14 : 9)};${r + 4}`}
                    dur={pulseDur}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values={`${isHov ? 0.6 : 0.18};${isHov ? 0.85 : 0.38};${isHov ? 0.6 : 0.18}`}
                    dur={pulseDur}
                    repeatCount="indefinite"
                  />
                </circle>

                {/* Cell body */}
                <circle
                  r={r}
                  fill="#090909"
                  stroke={n.color}
                  strokeWidth={isCenter ? 2.5 : n.kind === 'cluster' ? 2 : 1.5}
                  filter={isHov || isCenter ? 'url(#glow-lg)' : 'url(#glow-sm)'}
                />

                {/* Nucleus */}
                <circle r={r * 0.32} fill={n.color} opacity={0.85} />

                <text
                  y={r + 16}
                  textAnchor="middle"
                  fill={n.color}
                  fontSize={isCenter ? 15 : n.kind === 'cluster' ? 13 : 11}
                  style={{
                    fontFamily: 'Rajdhani, system-ui, sans-serif',
                    fontWeight: isCenter ? 700 : n.kind === 'cluster' ? 600 : 400,
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                >
                  {trunc(n.label, isCenter ? 22 : n.kind === 'cluster' ? 20 : 30)}
                </text>
              </g>
            );
          })}
        </g>

        {isEmpty && (
          <text
            x={VW / 2}
            y={VH / 2}
            textAnchor="middle"
            fill="#3a3a3a"
            fontSize={15}
            style={{ fontFamily: 'Space Mono, monospace' }}
          >
            add ideas to grow the network
          </text>
        )}
      </svg>

      <div className="mindmap-hint">scroll to zoom · drag to pan · hover to highlight</div>
    </div>
  );
}
