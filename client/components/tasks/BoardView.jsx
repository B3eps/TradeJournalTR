// Kanban board: columns by project or by priority, native HTML5 drag-and-drop.
const React = require('react');
const { useState, useRef } = React;
const { AnimatedCheck } = require('../ui/motion');
const TI = require('./TaskIcons');
const U = require('./taskUtils');
const TaskRow = require('./TaskRow');

const { TaskMeta } = TaskRow;
const DRAG_MIME = 'application/x-task-id';

const Card = ({ task, project, showProject, selected, completing, isRunning, now, onToggle, onOpen, onTimer, onSelect, onDragStart, onDragEnd, dragging }) => {
  const done = task.status === 'done' || completing;
  const pm = U.prio(task.priority);
  const pending = String(task.id).startsWith('tmp-');
  return (
    <div
      id={`task-row-${task.id}`}
      draggable={!pending}
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onClick={() => { onSelect(task.id); onOpen(task); }}
      className={`group ui-hover-lift bg-bg-surface border rounded-lg p-2.5 cursor-grab active:cursor-grabbing transition-opacity ${
        selected ? 'border-accent/50' : 'border-border'
      } ${dragging ? 'opacity-40' : ''} ${pending ? 'opacity-60' : ''}`}
      style={task.priority < 4 ? { borderLeft: `3px solid ${pm.color}` } : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="pt-0.5">
          <AnimatedCheck checked={done} onChange={() => { if (!pending) onToggle(task); }} size={16} color={task.priority < 4 ? pm.color : 'rgb(var(--accent))'} aria-label="Tamamla" />
        </div>
        <span className={`flex-1 min-w-0 text-sm leading-snug break-words ${done ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>{task.title}</span>
        {task.status !== 'done' && !pending && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTimer(task); }}
            aria-label={isRunning ? 'Zamanlayıcıyı durdur' : 'Zamanlayıcıyı başlat'}
            className={`w-6 h-6 inline-flex items-center justify-center rounded-md flex-shrink-0 transition-opacity ${isRunning ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:text-text-primary opacity-0 group-hover:opacity-100'}`}
          >
            {isRunning ? <TI.Stop className="w-3 h-3" /> : <TI.Play className="w-3 h-3" />}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 mt-2 empty:hidden">
        <TaskMeta task={task} project={project} showProject={showProject} isRunning={isRunning} now={now} compact />
      </div>
    </div>
  );
};

const BoardView = ({
  tasks, groupBy, projects, selectedId, completingIds, runningId, now,
  onMove, onToggle, onOpen, onTimer, onSelect,
}) => {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const dragTaskRef = useRef(null);

  const projectById = (id) => (projects || []).find(p => U.sameId(p.id, id));

  let columns;
  if (groupBy === 'priority') {
    columns = [1, 2, 3, 4].map(p => ({
      key: `p${p}`,
      title: p === 4 ? 'Öncelik 4 (normal)' : U.prio(p).label,
      color: U.prio(p).color,
      value: { priority: p },
      match: (t) => t.priority === p,
    }));
  } else {
    const active = (projects || []).filter(p => !p.archived);
    columns = active.map(p => ({
      key: `proj-${p.id}`,
      title: p.name,
      color: p.color || '#64748b',
      value: { projectId: p.id },
      match: (t) => U.sameId(t.projectId, p.id),
    }));
    const orphan = tasks.filter(t => !t.projectId || !projectById(t.projectId));
    if (orphan.length) {
      columns.push({ key: 'proj-none', title: 'Projesiz', color: '#64748b', value: null, match: (t) => !t.projectId || !projectById(t.projectId) });
    }
  }

  const onDragStart = (e, task) => {
    dragTaskRef.current = task;
    setDragId(String(task.id));
    try {
      e.dataTransfer.setData(DRAG_MIME, String(task.id));
      e.dataTransfer.setData('text/plain', task.title || '');
      e.dataTransfer.effectAllowed = 'move';
    } catch (err) { /* ignore */ }
  };
  const onDragEnd = () => { setDragId(null); setOverCol(null); dragTaskRef.current = null; };

  const onDrop = (e, col) => {
    e.preventDefault();
    const task = dragTaskRef.current;
    setOverCol(null);
    setDragId(null);
    dragTaskRef.current = null;
    if (!task || !col.value || col.match(task)) return;
    onMove(task, col.value);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1" role="list" aria-label="Pano">
      {columns.map(col => {
        const colTasks = tasks.filter(col.match);
        const isOver = overCol === col.key;
        return (
          <section
            key={col.key}
            aria-label={col.title}
            onDragOver={(e) => { if (dragId && col.value) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ignore */ } if (overCol !== col.key) setOverCol(col.key); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(c => (c === col.key ? null : c)); }}
            onDrop={(e) => onDrop(e, col)}
            className={`w-72 flex-shrink-0 rounded-xl border p-2.5 transition-colors ${isOver ? 'border-accent bg-accent/5' : 'border-border bg-bg-surface/60'}`}
          >
            <header className="flex items-center gap-2 px-1 pb-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} />
              <h3 className="text-sm font-semibold text-text-primary truncate flex-1">{col.title}</h3>
              <span className="text-xs text-text-muted tabular-nums">{colTasks.length}</span>
            </header>
            <div className="space-y-2 min-h-[60px]">
              {colTasks.map(t => (
                <Card
                  key={t.id}
                  task={t}
                  project={projectById(t.projectId)}
                  showProject={groupBy === 'priority'}
                  selected={U.sameId(selectedId, t.id)}
                  completing={completingIds.has(String(t.id))}
                  isRunning={U.sameId(runningId, t.id)}
                  now={U.sameId(runningId, t.id) ? now : 0}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onTimer={onTimer}
                  onSelect={onSelect}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  dragging={dragId === String(t.id)}
                />
              ))}
              {colTasks.length === 0 && (
                <div className={`text-xs text-center py-5 rounded-lg border border-dashed ${isOver ? 'border-accent text-accent' : 'border-border text-text-muted'}`}>
                  {dragId ? 'Buraya bırak' : 'Görev yok'}
                </div>
              )}
            </div>
          </section>
        );
      })}
      {columns.length === 0 && <p className="text-sm text-text-muted p-4">Pano için önce bir proje ekle.</p>}
    </div>
  );
};

module.exports = BoardView;
