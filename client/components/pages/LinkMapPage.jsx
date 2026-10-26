const React = require('react');
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel, applyNodeChanges, useReactFlow } = require('@xyflow/react');
require('@xyflow/react/dist/style.css');
const { FadeIn, shouldAnimate } = require('../ui/motion');
const nav = require('../../utils/navigation');
const api = require('../linkmap/api');
const { computeLayout } = require('../linkmap/layout');
const { TYPE_ORDER, TYPE_META, TypeIcon, nodeTypes } = require('../linkmap/nodeTypes');
const DetailsPanel = require('../linkmap/DetailsPanel');

// =====================================================
// BAĞLANTI HARİTASI (link map)
// GET /api/graph -> nodes/edges, laid out client-side with a small force simulation.
// Chips filter by type, the search box highlights and centres matches, a click opens the
// details panel, double click / "Aç" navigates, "Odakla" keeps only the 1-2 hop neighbourhood.
// =====================================================

const PREFS_KEY = 'linkmap-prefs';
const LIMITS = [150, 300, 600];

const loadPrefs = () => {
  const def = { hidden: [], limit: 300 };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (p && typeof p === 'object') {
      return {
        hidden: Array.isArray(p.hidden) ? p.hidden.filter((t) => TYPE_ORDER.includes(t)) : [],
        limit: LIMITS.includes(p.limit) ? p.limit : 300,
      };
    }
  } catch (e) { /* ignore */ }
  return def;
};

const fold = (s) => String(s || '')
  .replace(/[İIı]/g, 'i')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

const EDGE_STYLE = {
  link: { stroke: 'rgb(var(--text-secondary))', width: 1.4, dash: undefined, opacity: 0.55 },
  wikilink: { stroke: '#a78bfa', width: 1.5, dash: '6 4', opacity: 0.75 },
  parent: { stroke: 'rgb(var(--text-muted))', width: 1.4, dash: '2 4', opacity: 0.8 },
  'card-source': { stroke: '#f472b6', width: 1.4, dash: '8 3 2 3', opacity: 0.7 },
  project: { stroke: 'rgb(var(--text-muted))', width: 1, dash: undefined, opacity: 0.28 },
};

const FLOW_CSS = `
.linkmap-flow {
  --xy-background-color: rgb(var(--bg-page));
  --xy-background-pattern-color: rgb(var(--border));
  --xy-controls-button-background-color: rgb(var(--bg-surface));
  --xy-controls-button-background-color-hover: rgb(var(--bg-input));
  --xy-controls-button-color: rgb(var(--text-secondary));
  --xy-controls-button-color-hover: rgb(var(--text-primary));
  --xy-controls-button-border-color: rgb(var(--border));
  --xy-controls-box-shadow: 0 2px 10px rgba(0,0,0,.35);
  --xy-minimap-background-color: rgb(var(--bg-surface));
  --xy-minimap-mask-background-color: rgb(var(--bg-page) / .72);
  --xy-attribution-background-color: transparent;
}
.linkmap-flow .react-flow__node { cursor: pointer; }
.linkmap-flow .react-flow__controls { border: 1px solid rgb(var(--border)); border-radius: 10px; overflow: hidden; }
.linkmap-flow .react-flow__controls-button { border-bottom-color: rgb(var(--border)); }
.linkmap-flow .react-flow__minimap { border: 1px solid rgb(var(--border)); border-radius: 10px; overflow: hidden; }
.linkmap-flow .react-flow__attribution a { color: rgb(var(--text-muted)); }
@media (prefers-reduced-motion: reduce) { .linkmap-flow .linkmap-node { transition: none !important; } }
`;

const Chip = ({ type, count, off, onToggle }) => {
  const meta = TYPE_META[type];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!off}
      className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-xs transition-colors ${off ? 'border-border text-text-muted bg-transparent hover:text-text-secondary' : 'border-border bg-bg-surface text-text-primary hover:bg-bg-input'}`}
    >
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: off ? 'transparent' : meta.color, border: `1.5px solid ${meta.color}` }} />
      {meta.plural}
      <span className="tabular-nums text-text-muted">{count}</span>
    </button>
  );
};

const HowTo = ({ onNavigate }) => {
  const go = (page) => (onNavigate ? onNavigate(page) : nav.navigate(page));
  const steps = [
    ['Notlarda wikilink', 'Bir notun içine [[Başka Not]] ya da [[görev:…]] yazdığında iki öğe bağlanır.'],
    ['Görevde "İlişkilendir"', 'Görev çekmecesinden işlem, haber veya notları göreve bağla.'],
    ['Alt görev ve kartlar', 'Alt görevler üst göreve, kaynağı olan kartlar kaynağına otomatik bağlanır.'],
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center bg-bg-surface/90 backdrop-blur border border-border rounded-2xl px-6 py-7">
        <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-bg-input flex items-center justify-center text-text-secondary">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="6" cy="7" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8.3 8l2.6 7.7M15.8 8l-2.6 7.7M8.5 7h7" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-text-primary">Henüz bağlı bir şey yok</h2>
        <p className="text-sm text-text-secondary mt-1">Harita, birbirine bağladığın öğelerden oluşur. Başlamak için:</p>
        <ul className="mt-4 space-y-3 text-left">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-bg-input text-[11px] font-semibold text-text-secondary flex items-center justify-center">{i + 1}</span>
              <span className="text-xs text-text-secondary"><span className="font-medium text-text-primary">{t}.</span> {d}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={() => go('notes')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:bg-accent/90 transition-colors">Notlara git</button>
          <button type="button" onClick={() => go('tasks')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">Görevlere git</button>
        </div>
      </div>
    </div>
  );
};

const LinkMapInner = ({ onNavigate }) => {
  const rf = useReactFlow();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [focus, setFocus] = useState(null); // { id, hops }
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [rfNodes, setRfNodes] = useState([]);
  const posRef = useRef(new Map());
  const matchesRef = useRef(new Set());
  const hidden = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);

  const savePrefs = (next) => {
    setPrefs(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  };

  // ---- data ----
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.getGraph({ limit: prefs.limit })
      .then((g) => {
        if (!alive) return;
        posRef.current = computeLayout(g.nodes, g.edges);
        setGraph(g);
        setError('');
        setLayoutVersion((v) => v + 1);
      })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [prefs.limit, reloadKey]);

  // ---- derived ----
  const nodeById = useMemo(() => {
    const m = new Map();
    if (graph) graph.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [graph]);

  const adjacency = useMemo(() => {
    const m = new Map();
    if (!graph) return m;
    graph.edges.forEach((e) => {
      if (!m.has(e.source)) m.set(e.source, []);
      if (!m.has(e.target)) m.set(e.target, []);
      m.get(e.source).push({ id: e.target, kind: e.kind });
      m.get(e.target).push({ id: e.source, kind: e.kind });
    });
    return m;
  }, [graph]);

  const counts = useMemo(() => {
    const c = {};
    TYPE_ORDER.forEach((t) => { c[t] = 0; });
    if (graph) graph.nodes.forEach((n) => { c[n.type] = (c[n.type] || 0) + 1; });
    return c;
  }, [graph]);

  const focusSet = useMemo(() => {
    if (!focus || !nodeById.has(focus.id)) return null;
    const seen = new Set([focus.id]);
    let frontier = [focus.id];
    for (let h = 0; h < focus.hops; h++) {
      const next = [];
      frontier.forEach((id) => (adjacency.get(id) || []).forEach((nb) => {
        if (!seen.has(nb.id)) { seen.add(nb.id); next.push(nb.id); }
      }));
      frontier = next;
    }
    return seen;
  }, [focus, adjacency, nodeById]);

  const visibleNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((n) => !hidden.has(n.type) && (!focusSet || focusSet.has(n.id)));
  }, [graph, hidden, focusSet]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => (graph ? graph.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)) : []),
    [graph, visibleIds],
  );

  const q = fold(query).trim();
  const matches = useMemo(() => {
    const s = new Set();
    if (!q) return s;
    visibleNodes.forEach((n) => { if (fold(n.label).includes(q)) s.add(n.id); });
    return s;
  }, [q, visibleNodes]);
  matchesRef.current = matches;

  const selectedNode = selectedId && visibleIds.has(selectedId) ? nodeById.get(selectedId) : null;

  const connections = useMemo(() => {
    if (!selectedNode) return [];
    const out = [];
    visibleEdges.forEach((e) => {
      if (e.source === selectedNode.id && nodeById.has(e.target)) out.push({ node: nodeById.get(e.target), kind: e.kind });
      else if (e.target === selectedNode.id && nodeById.has(e.source)) out.push({ node: nodeById.get(e.source), kind: e.kind });
    });
    return out;
  }, [selectedNode, visibleEdges, nodeById]);

  const active = useMemo(() => {
    if (q) return matches;
    if (selectedNode) {
      const s = new Set([selectedNode.id]);
      connections.forEach((c) => s.add(c.node.id));
      return s;
    }
    return null;
  }, [q, matches, selectedNode, connections]);

  // ---- React Flow nodes / edges ----
  const baseNodes = useMemo(() => visibleNodes.map((n) => ({
    id: n.id,
    type: 'mapnode',
    position: posRef.current.get(n.id) || { x: 0, y: 0 },
    initialWidth: 172,
    initialHeight: 44,
    data: {
      type: n.type,
      label: n.label,
      meta: n.meta,
      isSelected: n.id === selectedId,
      match: !!q && matches.has(n.id),
      dim: !!active && !active.has(n.id) && n.id !== selectedId,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [visibleNodes, selectedId, q, matches, active, layoutVersion]);

  useEffect(() => {
    setRfNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return baseNodes.map((n) => {
        const p = old.get(n.id);
        return p && p.measured ? { ...n, measured: p.measured } : n;
      });
    });
  }, [baseNodes]);

  const onNodesChange = useCallback((changes) => {
    changes.forEach((c) => { if (c.type === 'position' && c.position) posRef.current.set(c.id, c.position); });
    setRfNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'select'), ns));
  }, []);

  const rfEdges = useMemo(() => visibleEdges.map((e) => {
    const st = EDGE_STYLE[e.kind] || EDGE_STYLE.link;
    const touches = !!selectedId && (e.source === selectedId || e.target === selectedId);
    const inActive = !active || (active.has(e.source) && active.has(e.target));
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'straight',
      selectable: false,
      focusable: false,
      zIndex: touches ? 5 : 0,
      style: {
        stroke: touches ? 'rgb(var(--accent))' : st.stroke,
        strokeWidth: touches ? 2.4 : st.width,
        strokeDasharray: st.dash,
        opacity: touches ? 1 : inActive ? st.opacity : 0.06,
        transition: 'opacity .18s',
      },
    };
  }), [visibleEdges, selectedId, active]);

  // ---- view control ----
  const duration = () => (shouldAnimate() ? 450 : 0);
  const fitAll = useCallback(() => { rf.fitView({ padding: 0.18, duration: duration(), maxZoom: 1.2 }); }, [rf]);

  const hiddenKey = prefs.hidden.join(',');
  const focusKey = focus ? `${focus.id}|${focus.hops}` : '';
  useEffect(() => {
    // Nodes are measured a moment after they render, so fit again shortly afterwards.
    const timers = [90, 450, 1000].map((ms) => setTimeout(fitAll, ms));
    return () => timers.forEach(clearTimeout);
  }, [layoutVersion, hiddenKey, focusKey, fitAll]);

  const centerOn = useCallback((ids, maxZoom) => {
    const list = ids.slice(0, 40).map((id) => ({ id }));
    if (!list.length) return;
    rf.fitView({ nodes: list, padding: list.length === 1 ? 1.4 : 0.5, maxZoom: maxZoom || 1.3, duration: duration() });
  }, [rf]);

  useEffect(() => {
    if (!q) return undefined;
    const t = setTimeout(() => { centerOn([...matchesRef.current]); }, 350);
    return () => clearTimeout(t);
  }, [q, centerOn]);

  const relayout = () => {
    if (!graph) return;
    posRef.current = computeLayout(visibleNodes, visibleEdges);
    graph.nodes.forEach((n) => { if (!posRef.current.has(n.id)) posRef.current.set(n.id, { x: 0, y: 0 }); });
    setLayoutVersion((v) => v + 1);
  };

  // ---- actions ----
  const openNode = useCallback((n) => {
    if (!n) return;
    const meta = TYPE_META[n.type];
    if (!meta) return;
    if (n.type === 'project') { nav.navigate('tasks'); return; }
    nav.navigate(meta.page, n.id.slice(n.type.length + 1), { itemType: n.type });
  }, []);

  const toggleType = (t) => {
    const next = new Set(prefs.hidden);
    if (next.has(t)) next.delete(t); else next.add(t);
    savePrefs({ ...prefs, hidden: [...next] });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (focus) setFocus(null);
      else if (selectedId) setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, selectedId]);

  const total = graph ? graph.nodes.filter((n) => n.type !== 'project').length : 0;
  const linkCount = graph ? graph.edges.filter((e) => e.kind !== 'project').length : 0;
  const empty = !!graph && graph.nodes.length === 0;
  const focusNode = focus ? nodeById.get(focus.id) : null;

  return (
    <div className="flex flex-col gap-3 h-full">
      <style>{FLOW_CSS}</style>
      <FadeIn className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Bağlantı Haritası</h1>
          <p className="text-sm text-text-secondary mt-0.5" aria-live="polite">
            {graph && !empty
              ? `${total} öğe · ${linkCount} bağlantı${graph.truncated ? ` · en bağlantılı ${prefs.limit} öğe gösteriliyor` : ''}`
              : 'Görevlerin, notların, işlemlerin ve haberlerin birbirine nasıl bağlandığını gör.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Haritada ara</span>
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') centerOn([...matches]);
                if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); }
              }}
              placeholder="Haritada ara…"
              className="w-52 pl-8 pr-3 py-1.5 text-sm rounded-lg bg-bg-input border border-border text-text-primary placeholder:text-text-muted outline-none focus:border-accent/60"
            />
          </label>
          {q && <span className="text-xs text-text-muted tabular-nums">{matches.size} eşleşme</span>}
          <select
            value={prefs.limit}
            onChange={(e) => savePrefs({ ...prefs, limit: Number(e.target.value) })}
            aria-label="Gösterilecek en fazla öğe sayısı"
            className="py-1.5 pl-2 pr-6 text-xs rounded-lg bg-bg-input border border-border text-text-secondary outline-none"
          >
            {LIMITS.map((l) => <option key={l} value={l}>En çok {l} öğe</option>)}
          </select>
          <button type="button" onClick={fitAll} className="px-2.5 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">Sığdır</button>
          <button type="button" onClick={relayout} className="px-2.5 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">Yeniden düzenle</button>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="px-2.5 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors">Yenile</button>
        </div>
      </FadeIn>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tür filtreleri">
        {TYPE_ORDER.map((t) => <Chip key={t} type={t} count={counts[t] || 0} off={hidden.has(t)} onToggle={() => toggleType(t)} />)}
      </div>

      <div className="flex gap-3 flex-1 min-h-0" style={{ minHeight: 420 }}>
        <div className="linkmap-flow relative flex-1 min-w-0 rounded-2xl border border-border overflow-hidden bg-bg-page">
          {error && !graph ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-6">
              <p className="text-sm text-text-secondary">{error}</p>
              <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text">Tekrar dene</button>
            </div>
          ) : (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(e, n) => setSelectedId(n.id)}
              onNodeDoubleClick={(e, n) => openNode(nodeById.get(n.id))}
              onPaneClick={() => setSelectedId(null)}
              nodesConnectable={false}
              elementsSelectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              onlyRenderVisibleElements
              minZoom={0.05}
              maxZoom={2.2}
              zoomOnDoubleClick={false}
              aria-label="Bağlantı haritası"
            >
              <Background gap={28} size={1.2} />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                nodeColor={(n) => (TYPE_META[n.data && n.data.type] ? TYPE_META[n.data.type].color : '#94a3b8')}
                nodeStrokeWidth={0}
              />
              {focusNode && (
                <Panel position="top-center">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-surface border border-border shadow-lg text-xs text-text-secondary">
                    <TypeIcon type={focusNode.type} />
                    <span className="max-w-[220px] truncate text-text-primary">{focusNode.label}</span>
                    <span className="text-text-muted">· {focus.hops} adım komşuluk · {visibleNodes.length} öğe</span>
                    <button type="button" onClick={() => setFocus(null)} className="ml-1 text-accent hover:underline">Tümünü göster</button>
                  </div>
                </Panel>
              )}
            </ReactFlow>
          )}
          {loading && !graph && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted pointer-events-none">Harita hazırlanıyor…</div>
          )}
          {empty && !loading && <HowTo onNavigate={onNavigate} />}
          {!empty && graph && visibleNodes.length === 0 && !loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted pointer-events-none">Bu filtrelerle gösterilecek öğe yok. Yukarıdan bir tür aç.</div>
          )}
        </div>

        {selectedNode && (
          <DetailsPanel
            node={selectedNode}
            connections={connections}
            focusActive={!!focus}
            focusHops={focus ? focus.hops : 1}
            onClose={() => setSelectedId(null)}
            onOpen={() => openNode(selectedNode)}
            onFocus={() => setFocus({ id: selectedNode.id, hops: focus ? focus.hops : 1 })}
            onUnfocus={() => setFocus(null)}
            onSetHops={(h) => setFocus({ id: focus ? focus.id : selectedNode.id, hops: h })}
            onPick={(id) => { setSelectedId(id); centerOn([id], 1.2); }}
          />
        )}
      </div>
    </div>
  );
};

const LinkMapPage = ({ onNavigate }) => (
  <div className="p-4 sm:p-6 max-w-[1600px] mx-auto w-full" style={{ height: 'calc(100vh - 2rem)', minHeight: 560 }}>
    <ReactFlowProvider>
      <LinkMapInner onNavigate={onNavigate} />
    </ReactFlowProvider>
  </div>
);

module.exports = LinkMapPage;
