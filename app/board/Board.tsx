'use client';

import './board.css';
import { useState, useEffect, useRef, useCallback } from 'react';
import MindMap from './MindMap';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';

type Cluster = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
};

type Idea = {
  id: string;
  cluster_id: string | null;
  parent_id: string | null;
  text: string;
  raw_text: string | null;
  prior_art: string | null;
  branch: string | null;
  confidence: string;
  created_at: string;
};

function shorten(t: string, n = 38) {
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// ── sub-components (hooks can't live inside .map) ─────────────────────────────

type CardProps = {
  idea: Idea;
  ideas: Idea[];
  onDelete: (id: string) => void;
  onBranch: (idea: Idea) => void;
  onRemix: (id: string, newText: string) => void;
  isOverlay?: boolean;
};

const SLOT_CHARS = 'abcdefghijklmnopqrstuvwxyz';

function IdeaCard({ idea, ideas, onDelete, onBranch, onRemix, isOverlay = false }: CardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `idea-${idea.id}`,
  });

  const [slotDisplay, setSlotDisplay] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const slotRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (slotRef.current) clearInterval(slotRef.current); }, []);

  async function doRemix() {
    if (spinning || isOverlay) return;
    setSpinning(true);
    const original = idea.text;
    const spaces = new Set(Array.from(original).flatMap((c, i) => (c === ' ' ? [i] : [])));

    // Phase 1: scramble original length while fetching
    slotRef.current = setInterval(() => {
      setSlotDisplay(
        Array.from({ length: original.length }, (_, i) =>
          spaces.has(i) ? ' ' : SLOT_CHARS[Math.floor(Math.random() * SLOT_CHARS.length)],
        ).join(''),
      );
    }, 40);

    try {
      const res = await fetch('/api/remix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: original }),
      });
      clearInterval(slotRef.current);
      if (!res.ok) { setSlotDisplay(null); setSpinning(false); return; }

      const { variation } = await res.json();
      const words = (variation as string).split(' ');
      let done = 0;

      // Phase 2: settle word by word
      slotRef.current = setInterval(() => {
        done++;
        setSlotDisplay(
          words
            .map((w, i) =>
              i < done
                ? w
                : Array.from(w, () => SLOT_CHARS[Math.floor(Math.random() * SLOT_CHARS.length)]).join(''),
            )
            .join(' '),
        );
        if (done >= words.length) {
          clearInterval(slotRef.current!);
          setSlotDisplay(null);
          setSpinning(false);
          onRemix(idea.id, variation);
        }
      }, 85);
    } catch {
      if (slotRef.current) clearInterval(slotRef.current);
      setSlotDisplay(null);
      setSpinning(false);
    }
  }

  const parent = idea.parent_id ? ideas.find((x) => x.id === idea.parent_id) : null;

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      className={[
        'card',
        parent ? 'child' : '',
        isDragging ? 'dragging' : '',
        isOverlay ? 'drag-overlay' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ opacity: isDragging && !isOverlay ? 0.35 : 1 }}
      {...(isOverlay ? {} : { ...attributes, ...listeners })}
    >
      {parent && (
        <div className="lineage">
          ↳ spawned from <span>{parent.text}</span>
        </div>
      )}

      <p className={slotDisplay ? 'slot-text' : ''}>{slotDisplay ?? idea.text}</p>

      {idea.prior_art && !slotDisplay && <div className="prior-art">{idea.prior_art}</div>}

      {idea.branch && !isOverlay && !slotDisplay && (
        <button
          className="branch-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onBranch(idea)}
          title="Pre-fill this next idea and set parent"
        >
          → {idea.branch}
        </button>
      )}

      {!isOverlay && (
        <>
          <button
            className={`remix-btn${spinning ? ' spinning' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={doRemix}
            title="Remix this idea"
          >
            ↻
          </button>
          <button
            className="del"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onDelete(idea.id)}
            title="Remove idea"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

type DroppableCardsProps = {
  clusterId: string;
  isEmpty: boolean;
  children: React.ReactNode;
};

function DroppableCards({ clusterId, isEmpty, children }: DroppableCardsProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `cluster-${clusterId}` });
  return (
    <div ref={setNodeRef} className={`cards${isOver ? ' drop-over' : ''}`}>
      {isEmpty ? (
        <div className="empty">empty lane — drag a card here or add one above</div>
      ) : (
        children
      )}
    </div>
  );
}

// ── main Board component ──────────────────────────────────────────────────────

export default function Board() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('Untitled session');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedCluster, setSelectedCluster] = useState('');
  const [selectedParent, setSelectedParent] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [pendingAutoSubmit, setPendingAutoSubmit] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [boardView, setBoardView] = useState<'board' | 'map'>('board');

  const [suggestion, setSuggestion] = useState('');
  const [suggestionFor, setSuggestionFor] = useState('');

  const recognitionRef = useRef<any>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const latestHandleAdd = useRef<() => void>(() => {});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // require 8px movement before drag starts so button clicks still work
      activationConstraint: { distance: 8 },
    }),
  );

  // ── init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const SR =
      typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    setHasMic(!!SR);

    if (SR) {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = 'en-US';

      r.onresult = (event: any) => {
        const transcript = Array.from(event.results as any[])
          .map((res: any) => res[0].transcript)
          .join('');
        setInputText(transcript);
      };

      r.onspeechend = () => {
        if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
        setPendingAutoSubmit(true);
        autoSubmitTimerRef.current = setTimeout(() => {
          setPendingAutoSubmit(false);
          recognitionRef.current?.stop();
          latestHandleAdd.current();
        }, 1500);
      };

      r.onspeechstart = () => {
        if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
        setPendingAutoSubmit(false);
      };

      r.onend = () => setIsListening(false);

      r.onerror = (e: any) => {
        setIsListening(false);
        setPendingAutoSubmit(false);
        if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
        if (e.error === 'not-allowed') {
          showToast('Mic blocked — allow microphone in Chrome then reload');
        } else if (e.error !== 'no-speech') {
          showToast(`Mic error: ${e.error}`);
        }
      };

      recognitionRef.current = r;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = useCallback(async (sid: string) => {
    const res = await fetch(`/api/data?session_id=${sid}`);
    if (!res.ok) return;
    const data = await res.json();
    setClusters(data.clusters ?? []);
    setIdeas(data.ideas ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/board/session');
      if (!res.ok) return;
      const sess = await res.json();
      setSessionId(sess.id);
      setSessionName(sess.name ?? 'Untitled session');
      await fetchAll(sess.id);
    })();
  }, [fetchAll]);

  // ── autosuggest ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    if (!inputText.trim() || inputText.trim().length < 4 || isListening) {
      setSuggestion('');
      setSuggestionFor('');
      return;
    }
    suggestTimerRef.current = setTimeout(async () => {
      if (suggestAbortRef.current) suggestAbortRef.current.abort();
      const ctrl = new AbortController();
      suggestAbortRef.current = ctrl;
      const capturedText = inputText.trim();
      try {
        const res = await fetch('/api/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: capturedText }),
          signal: ctrl.signal,
        });
        if (!res.ok || ctrl.signal.aborted) return;
        const { suggestion: s } = await res.json();
        setSuggestion(s ?? '');
        setSuggestionFor(capturedText);
      } catch {
        // aborted or network error — ignore
      }
    }, 400);
    return () => {
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    };
  }, [inputText, isListening]); // eslint-disable-line react-hooks/exhaustive-deps

  function syncScroll() {
    if (ghostRef.current && inputRef.current) {
      ghostRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }

  // ── toast ──────────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2200);
  }

  // ── session name ───────────────────────────────────────────────────────────

  function startEditingName() {
    setNameInput(sessionName);
    setIsEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }

  async function saveSessionName() {
    setIsEditingName(false);
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === sessionName || !sessionId) return;
    const res = await fetch('/api/board/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId, name: trimmed }),
    });
    if (res.ok) setSessionName(trimmed);
  }

  // ── mic ────────────────────────────────────────────────────────────────────

  function toggleMic() {
    if (!recognitionRef.current) return;
    if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
    setPendingAutoSubmit(false);
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setInputText('');
      recognitionRef.current.start();
      setIsListening(true);
    }
  }

  // ── add idea ───────────────────────────────────────────────────────────────

  async function handleAdd() {
    const text = inputText.trim();
    if (!text || !sessionId || isAdding) return;

    if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
    setPendingAutoSubmit(false);

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    setIsAdding(true);
    try {
      const augRes = await fetch('/api/augment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: text,
          existingLanes: clusters.map((c) => c.name),
        }),
      });

      let augData: any = {
        cleaned: text,
        category: 'Unsorted',
        prior_art: null,
        branch: null,
        confidence: 'low',
      };
      if (augRes.ok) {
        augData = await augRes.json();
      } else {
        showToast('Augment failed — saving as Unsorted');
      }

      const ideaRes = await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          raw_text: text,
          text: augData.cleaned ?? text,
          category: augData.category ?? null,
          prior_art: augData.prior_art ?? null,
          branch: augData.branch ?? null,
          confidence: augData.confidence ?? 'medium',
          parent_id: selectedParent || null,
          cluster_id: selectedCluster || null,
        }),
      });

      if (!ideaRes.ok) {
        showToast('Failed to save idea');
        return;
      }

      await fetchAll(sessionId);
      setInputText('');
      setSelectedParent('');
      setSuggestion('');
      setSuggestionFor('');
      showToast('Idea captured');
      inputRef.current?.focus();
    } catch {
      showToast('Error — check your connection');
    } finally {
      setIsAdding(false);
    }
  }

  latestHandleAdd.current = handleAdd;

  // ── drag ───────────────────────────────────────────────────────────────────

  function handleDragStart({ active }: DragStartEvent) {
    setDragActiveId(active.id as string);
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    setDragActiveId(null);
    if (!over) return;

    const ideaId = (active.id as string).replace('idea-', '');
    const targetClusterId = (over.id as string).replace('cluster-', '');
    const idea = ideas.find((i) => i.id === ideaId);

    if (!idea || idea.cluster_id === targetClusterId) return;

    // Optimistic update so the card moves instantly.
    setIdeas((prev) =>
      prev.map((i) => (i.id === ideaId ? { ...i, cluster_id: targetClusterId } : i)),
    );

    await fetch('/api/ideas', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ideaId, cluster_id: targetClusterId }),
    });
  }

  // ── branch shortcut ────────────────────────────────────────────────────────

  function spawnBranch(idea: Idea) {
    if (!idea.branch) return;
    setInputText(idea.branch);
    setSelectedParent(idea.id);
    setSelectedCluster(idea.cluster_id || '');
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── cluster actions ────────────────────────────────────────────────────────

  async function handleCreateCluster() {
    if (!sessionId) return;
    const name = window.prompt('New lane name:');
    if (!name?.trim()) return;
    const res = await fetch('/api/clusters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, name: name.trim() }),
    });
    if (res.ok) {
      const cluster = await res.json();
      setClusters((prev) => [...prev, cluster]);
      setSelectedCluster(cluster.id);
    }
  }

  async function handleDeleteCluster(clusterId: string, clusterName: string) {
    const count = ideas.filter((i) => i.cluster_id === clusterId).length;
    const msg =
      count > 0
        ? `Delete lane "${clusterName}" and its ${count} idea${count === 1 ? '' : 's'}? This cannot be undone.`
        : `Delete empty lane "${clusterName}"?`;
    if (!window.confirm(msg)) return;

    const res = await fetch(`/api/clusters?id=${clusterId}`, { method: 'DELETE' });
    if (res.ok) {
      setClusters((prev) => prev.filter((c) => c.id !== clusterId));
      setIdeas((prev) => prev.filter((i) => i.cluster_id !== clusterId));
      if (selectedCluster === clusterId) setSelectedCluster('');
    }
  }

  async function handleRename(clusterId: string, currentName: string) {
    const name = window.prompt('Rename lane:', currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    const res = await fetch('/api/clusters', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clusterId, name: name.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setClusters((prev) => prev.map((c) => (c.id === clusterId ? updated : c)));
    }
  }

  // ── idea actions ───────────────────────────────────────────────────────────

  async function handleRemix(ideaId: string, newText: string) {
    setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, text: newText } : i)));
    await fetch('/api/ideas', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ideaId, text: newText }),
    });
  }

  async function handleDelete(ideaId: string) {
    const res = await fetch(`/api/ideas?id=${ideaId}`, { method: 'DELETE' });
    if (res.ok) {
      setIdeas((prev) =>
        prev
          .filter((i) => i.id !== ideaId)
          .map((i) => (i.parent_id === ideaId ? { ...i, parent_id: null } : i)),
      );
    }
  }

  async function handleClear() {
    if (!sessionId) return;
    if (!window.confirm('Clear every idea from the board? This cannot be undone.')) return;
    await fetch(`/api/ideas?session_id=${sessionId}`, { method: 'DELETE' });
    setIdeas([]);
    showToast('Board cleared');
  }

  // ── harvest ────────────────────────────────────────────────────────────────

  async function handleHarvest(mode: 'download' | 'copy') {
    if (!sessionId || ideas.length === 0) {
      showToast('No ideas to harvest yet');
      return;
    }
    setIsHarvesting(true);
    try {
      const res = await fetch('/api/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!res.ok) {
        showToast('Harvest failed — try again');
        return;
      }
      const { markdown } = await res.json();
      if (mode === 'download') {
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ideation-harvest-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Harvest downloaded');
      } else {
        try {
          await navigator.clipboard.writeText(markdown);
          showToast('Harvest copied');
        } catch {
          showToast('Copy blocked — use Harvest ↓');
        }
      }
    } catch {
      showToast('Harvest failed — check connection');
    } finally {
      setIsHarvesting(false);
    }
  }

  // ── derived ────────────────────────────────────────────────────────────────

  const parentIdea = ideas.find((i) => i.id === selectedParent);
  const dragActiveIdea = dragActiveId
    ? ideas.find((i) => `idea-${i.id}` === dragActiveId)
    : null;

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── header ── */}
      <header>
        <div className="mark">
          Ideation<b>·</b>Club
        </div>

        {isEditingName ? (
          <input
            ref={nameInputRef}
            className="session-name-input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={saveSessionName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveSessionName();
              if (e.key === 'Escape') setIsEditingName(false);
            }}
          />
        ) : (
          <span
            className="session-name"
            onClick={startEditingName}
            title="Click to name this session"
          >
            {sessionName} ✎
          </span>
        )}

        <div className="count">
          ideas <strong>{ideas.length}</strong>
        </div>

        <div className="view-toggle">
          <button
            className={boardView === 'board' ? 'active' : ''}
            onClick={() => setBoardView('board')}
          >
            Lanes
          </button>
          <button
            className={boardView === 'map' ? 'active' : ''}
            onClick={() => setBoardView('map')}
          >
            Mind Map
          </button>
        </div>
      </header>

      {/* ── capture bar ── */}
      <div className="capture">
        <div className="capture-main">
          {hasMic && (
            <button
              id="mic"
              className={isListening ? 'listening' : ''}
              onClick={toggleMic}
              disabled={isAdding}
              title={isListening ? 'Stop listening' : 'Click to speak an idea'}
            >
              {isListening
                ? pendingAutoSubmit
                  ? '⏳ Adding…'
                  : '⏹ Stop'
                : '🎤 Speak'}
            </button>
          )}

          <div className="capture-input-wrap">
            {suggestion && inputText.trim() === suggestionFor && (
              <div ref={ghostRef} className="ghost-overlay" aria-hidden="true">
                <span className="ghost-typed">{inputText}</span>
                <span className="ghost-suggest">
                  {inputText.endsWith(' ') ? '' : ' '}{suggestion}
                </span>
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              id="idea"
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                requestAnimationFrame(syncScroll);
              }}
              onScroll={syncScroll}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && suggestion && inputText.trim() === suggestionFor) {
                  e.preventDefault();
                  const gap = inputText.endsWith(' ') ? '' : ' ';
                  setInputText(inputText + gap + suggestion);
                  setSuggestion('');
                  setSuggestionFor('');
                  return;
                }
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') {
                  setSuggestion('');
                  setSuggestionFor('');
                }
              }}
              placeholder={
                isListening
                  ? pendingAutoSubmit
                    ? 'Adding in a moment…'
                    : 'Listening…'
                  : hasMic
                  ? 'Speak or type an idea…'
                  : 'Type an idea, then Enter or Add…'
              }
              autoComplete="off"
              disabled={isListening}
            />
          </div>

          <button id="add" onClick={handleAdd} disabled={isAdding || !inputText.trim()}>
            {isAdding ? 'Claude thinking…' : pendingAutoSubmit ? 'Adding…' : 'Add Idea'}
          </button>
        </div>

        <div className="capture-meta">
          <div className="field-group">
            <span className="field-label">Lane</span>
            <select
              id="cluster"
              value={selectedCluster}
              onChange={(e) =>
                e.target.value === '__new'
                  ? handleCreateCluster()
                  : setSelectedCluster(e.target.value)
              }
              title="Which lane — leave blank and Claude decides"
            >
              <option value="">Auto (Claude picks)</option>
              {clusters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new">+ New lane…</option>
            </select>
          </div>

          <div className="field-group">
            <span className="field-label">Spawned from</span>
            <select
              id="parent"
              value={selectedParent}
              onChange={(e) => setSelectedParent(e.target.value)}
              title="Set a parent to thread this as a branch"
            >
              <option value="">None (standalone)</option>
              {ideas.map((i) => (
                <option key={i.id} value={i.id}>
                  {shorten(i.text)}
                </option>
              ))}
            </select>
            {selectedParent && (
              <button
                className="clear-parent"
                onClick={() => setSelectedParent('')}
                title="Clear parent"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {parentIdea && (
          <div className="parent-preview">
            ↳ branching from: &ldquo;{shorten(parentIdea.text, 80)}&rdquo;
          </div>
        )}

        <div className="hint">
          {hasMic
            ? 'Speak or type · pause to auto-add · Tab to accept suggestion · drag cards between lanes · click → to branch · double-click a lane to rename'
            : 'Type · Enter to add · Tab to accept suggestion · drag cards between lanes · click → to branch · double-click a lane to rename'}
        </div>
      </div>

      {/* ── board / mind map ── */}
      <main className={boardView === 'map' ? 'main-map' : ''}>
        {boardView === 'map' ? (
          <MindMap clusters={clusters} ideas={ideas} sessionName={sessionName} />
        ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragActiveId(null)}
        >
          <div className="board">
            {clusters.length === 0 && ideas.length === 0 && (
              <div className="empty-board">
                <div className="empty-steps">
                  <div className="empty-step">
                    <span className="step-n">1</span>
                    <span>
                      {hasMic
                        ? 'Click Speak and say an idea — pause and it auto-adds'
                        : 'Type an idea and press Enter or Add Idea'}
                    </span>
                  </div>
                  <div className="empty-step">
                    <span className="step-n">2</span>
                    <span>Claude cleans it, picks a lane, and drops it as a card</span>
                  </div>
                  <div className="empty-step">
                    <span className="step-n">3</span>
                    <span>Drag cards between lanes · click → to spin off a branch</span>
                  </div>
                  <div className="empty-step">
                    <span className="step-n">4</span>
                    <span>Hit Harvest — Claude writes the synthesis doc</span>
                  </div>
                </div>
              </div>
            )}

            {clusters.map((cluster) => {
              const mine = ideas.filter((i) => i.cluster_id === cluster.id);
              const ordered = [
                ...mine.filter((i) => !i.parent_id),
                ...mine.filter((i) => !!i.parent_id),
              ];
              return (
                <div
                  key={cluster.id}
                  className="cluster"
                  style={{ '--ch': `var(${cluster.color})` } as React.CSSProperties}
                >
                  <div className="cluster-head">
                    <span className="dot" />
                    <h2
                      onDoubleClick={() => handleRename(cluster.id, cluster.name)}
                      title="Double-click to rename"
                    >
                      {cluster.name}
                      <span className="rename-hint"> ✎</span>
                    </h2>
                    <span className="n">{mine.length}</span>
                    <button
                      className="del-lane"
                      onClick={() => handleDeleteCluster(cluster.id, cluster.name)}
                      title="Delete lane"
                    >
                      ×
                    </button>
                  </div>

                  <DroppableCards clusterId={cluster.id} isEmpty={ordered.length === 0}>
                    {ordered.map((idea) => (
                      <IdeaCard
                        key={idea.id}
                        idea={idea}
                        ideas={ideas}
                        onDelete={handleDelete}
                        onBranch={spawnBranch}
                        onRemix={handleRemix}
                      />
                    ))}
                  </DroppableCards>
                </div>
              );
            })}
          </div>

          {/* floating card that follows the cursor while dragging */}
          <DragOverlay dropAnimation={null}>
            {dragActiveIdea ? (
              <IdeaCard
                idea={dragActiveIdea}
                ideas={ideas}
                onDelete={() => {}}
                onBranch={() => {}}
                onRemix={() => {}}
                isOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
        )}
      </main>

      {/* ── footer ── */}
      <footer>
        <button
          className="btn primary"
          onClick={() => handleHarvest('download')}
          disabled={isHarvesting || ideas.length === 0}
          title="Claude synthesises all ideas into a markdown doc"
        >
          {isHarvesting ? 'Claude writing…' : 'Harvest ↓'}
        </button>
        <button
          className="btn"
          onClick={() => handleHarvest('copy')}
          disabled={isHarvesting || ideas.length === 0}
        >
          Copy harvest
        </button>
        <button className="btn" onClick={handleClear} disabled={ideas.length === 0}>
          Clear board
        </button>
        <div className="foot-note">Distillery Labs · Ideation Club</div>
      </footer>

      <div className={`toast${toastVisible ? ' show' : ''}`}>{toastMsg}</div>
    </>
  );
}
