// Grouped list view with animated enter/exit and manual drag reordering.
const React = require('react');
const { useState, useRef } = React;
const { AnimatePresence, motion } = require('framer-motion');
const { useAnimationsEnabled } = require('../ui/motion');
const TaskRow = require('./TaskRow');
const U = require('./taskUtils');

const TONE_TITLE = {
  overdue: 'text-negative',
  today: 'text-warning',
};

const TaskList = ({
  groups, projectById, selectedId, completingIds, runningId, now, showProject, manual, orphanIds,
  onReorder, onToggle, onOpen, onDelete, onTimer, onSelect,
}) => {
  const animate = useAnimationsEnabled();
  const [dropTarget, setDropTarget] = useState(null);
  const [dropPos, setDropPos] = useState('before');
  const dragRef = useRef(null);

  const drag = manual ? {
    dropTarget,
    dropPos,
    onDragStart: (e, task) => {
      dragRef.current = task;
      try { e.dataTransfer.setData('text/plain', task.title || ''); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
    },
    onDragOver: (e, task) => {
      if (!dragRef.current || U.sameId(dragRef.current.id, task.id)) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
      if (dropTarget !== String(task.id)) setDropTarget(String(task.id));
      if (dropPos !== pos) setDropPos(pos);
    },
    onDrop: (e, task) => {
      e.preventDefault();
      const dragged = dragRef.current;
      dragRef.current = null;
      setDropTarget(null);
      if (dragged && !U.sameId(dragged.id, task.id)) onReorder(dragged, task, dropPos);
    },
    onDragEnd: () => { dragRef.current = null; setDropTarget(null); },
  } : null;

  return (
    <div className="space-y-5">
      {groups.map(g => (
        <section key={g.key} aria-label={g.title || 'Görevler'}>
          {g.title && (
            <header className="flex items-baseline gap-2 px-3 pb-1.5 mb-1 border-b border-border">
              <h2 className={`text-sm font-semibold ${TONE_TITLE[g.tone] || 'text-text-primary'}`}>{g.title}</h2>
              {g.subtitle && <span className="text-xs text-text-muted">{g.subtitle}</span>}
              <span className="ml-auto text-xs text-text-muted tabular-nums">{g.tasks.length || ''}</span>
            </header>
          )}
          <div role="list">
            <AnimatePresence initial={false}>
              {g.tasks.map(t => (
                <motion.div
                  key={t.id}
                  layout={animate ? 'position' : false}
                  initial={animate ? { opacity: 0, height: 0 } : false}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={animate ? { opacity: 0, height: 0, transition: { duration: 0.22 } } : { opacity: 0, transition: { duration: 0 } }}
                  transition={{ duration: animate ? 0.2 : 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <TaskRow
                    task={t}
                    project={showProject ? projectById(t.projectId) : null}
                    showProject={showProject}
                    selected={U.sameId(selectedId, t.id)}
                    completing={completingIds.has(String(t.id))}
                    isRunning={U.sameId(runningId, t.id)}
                    now={U.sameId(runningId, t.id) ? now : 0}
                    orphanSubtask={orphanIds.has(String(t.id))}
                    onToggle={onToggle}
                    onOpen={onOpen}
                    onDelete={onDelete}
                    onTimer={onTimer}
                    onSelect={onSelect}
                    drag={drag}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
            {g.tasks.length === 0 && g.emptyText && (
              <p className="px-3 py-2 text-xs text-text-muted">{g.emptyText}</p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
};

module.exports = TaskList;
