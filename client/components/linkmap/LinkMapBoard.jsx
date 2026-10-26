const React = require('react');
const { useEffect, useMemo, useState, useCallback } = React;
const {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow,
} = require('@xyflow/react');
const { StickyNote, Type, Trash2, Link2 } = require('lucide-react');

const STORAGE_KEY = 'linkmap-free-board-v1';
const COLORS = [
  { label: 'Sarı', value: '#fef08a' },
  { label: 'Mavi', value: '#bfdbfe' },
  { label: 'Yeşil', value: '#bbf7d0' },
  { label: 'Pembe', value: '#fbcfe8' },
  { label: 'Mor', value: '#ddd6fe' },
];

function loadBoard() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return { nodes: [], edges: [] };
    return {
      nodes: value.nodes.filter((node) => node && typeof node.id === 'string' && node.position
        && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)).slice(0, 250),
      edges: value.edges.filter((edge) => edge && typeof edge.id === 'string'
        && typeof edge.source === 'string' && typeof edge.target === 'string').slice(0, 600),
    };
  } catch (e) { return { nodes: [], edges: [] }; }
}

const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-bg-surface text-sm text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors disabled:opacity-40';

const BoardInner = () => {
  const flow = useReactFlow();
  const initial = useMemo(loadBoard, []);
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [selectedId, setSelectedId] = useState(null);
  const selected = nodes.find((node) => node.id === selectedId) || null;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges })); } catch (e) { /* local storage can be unavailable */ }
  }, [nodes, edges]);

  const addCard = (kind, color = COLORS[0].value) => {
    if (nodes.length >= 250) return;
    const id = `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const position = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const sticky = kind === 'sticky';
    setNodes((current) => [...current, {
      id,
      type: 'default',
      position,
      data: { label: sticky ? 'Fikrinizi yazın…' : 'Metin ekleyin…' },
      style: sticky
        ? { width: 200, minHeight: 116, padding: 14, background: color, color: '#1f2937', border: '0', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.2)', fontSize: 14, whiteSpace: 'pre-wrap' }
        : { width: 220, padding: 14, background: 'rgb(var(--bg-surface))', color: 'rgb(var(--text-primary))', border: '1px solid rgb(var(--border))', borderRadius: 10, fontSize: 14, whiteSpace: 'pre-wrap' },
    }]);
    setSelectedId(id);
  };

  const updateSelected = (patch) => setNodes((current) => current.map((node) => node.id === selectedId
    ? { ...node, ...patch, data: patch.data ? { ...node.data, ...patch.data } : node.data, style: patch.style ? { ...node.style, ...patch.style } : node.style }
    : node));

  const onNodesChange = useCallback((changes) => {
    const removed = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    if (removed.size) setEdges((current) => current.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)));
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const onEdgesChange = useCallback((changes) => setEdges((current) => applyEdgeChanges(changes, current)), []);
  const onConnect = useCallback((connection) => setEdges((current) => addEdge({ ...connection, type: 'smoothstep', style: { stroke: '#818cf8', strokeWidth: 2 } }, current)), []);

  return (
    <div className="flex flex-col gap-3 h-full min-h-[430px]">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => addCard('sticky')}><StickyNote className="w-4 h-4" /> Yapışkan not</button>
        <button type="button" className={btn} onClick={() => addCard('text')}><Type className="w-4 h-4" /> Metin</button>
        <span className="hidden sm:inline text-xs text-text-tertiary ml-1"><Link2 className="inline w-3.5 h-3.5 mr-1" />Noktaları sürükleyerek bağla; kartları taşı ve seçerek düzenle.</span>
        {selected && <button type="button" className={`${btn} ml-auto text-negative`} onClick={() => { setNodes((current) => current.filter((node) => node.id !== selectedId)); setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId)); setSelectedId(null); }}><Trash2 className="w-4 h-4" /> Seçileni sil</button>}
      </div>

      <div className="linkmap-flow relative flex-1 min-h-[380px] rounded-2xl border border-border overflow-hidden bg-bg-page">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={({ nodes: picked }) => setSelectedId(picked[0] ? picked[0].id : null)}
          nodesConnectable
          nodesDraggable
          elementsSelectable
          deleteKeyCode={['Backspace', 'Delete']}
          fitView
          minZoom={0.08}
          maxZoom={2.5}
          aria-label="Bağımsız fikir panosu"
        >
          <Background gap={24} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" nodeColor={(node) => node.style?.background || '#818cf8'} nodeStrokeWidth={0} />
          {nodes.length === 0 && <Panel position="top-center"><div className="mt-4 rounded-xl border border-border bg-bg-surface/95 px-4 py-3 text-sm text-text-secondary shadow-lg">Boş panodan başla: yapışkan not ekle, sürükleyip yerleştir ve noktaları birleştir.</div></Panel>}
        </ReactFlow>
      </div>

      {selected && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg-surface p-3">
          <label className="flex-1 min-w-[220px] text-xs text-text-tertiary">Seçili kartın içeriği
            <textarea value={String(selected.data?.label || '')} onChange={(event) => updateSelected({ data: { label: event.target.value } })}
              rows={2} className="mt-1 block w-full resize-y rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-accent" />
          </label>
          <div className="flex items-center gap-1.5" role="group" aria-label="Not rengi">
            {COLORS.map((color) => <button key={color.value} type="button" onClick={() => updateSelected({ style: { background: color.value, color: '#1f2937' } })}
              aria-label={`${color.label} renk`} title={`${color.label} renk`} className="h-7 w-7 rounded-full border border-black/15" style={{ background: color.value }} />)}
          </div>
        </div>
      )}
    </div>
  );
};

const LinkMapBoard = () => <ReactFlowProvider><BoardInner /></ReactFlowProvider>;
module.exports = LinkMapBoard;
