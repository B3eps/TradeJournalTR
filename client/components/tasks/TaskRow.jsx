// One task in the list view.
const React = require('react');
const { AnimatedCheck } = require('../ui/motion');
const TI = require('./TaskIcons');
const U = require('./taskUtils');

const smallChip = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap';

const ActionBtn = ({ label, onClick, children, tone }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`w-7 h-7 inline-flex items-center justify-center rounded-md transition-colors ${tone || 'text-text-tertiary hover:text-text-primary hover:bg-bg-input'}`}
  >
    {children}
  </button>
);

// Meta chips shared by list rows and board cards.
const TaskMeta = ({ task, project, showProject, isRunning, now, compact }) => {
  const due = U.dueInfo(task);
  const spent = U.totalSpent(task, now);
  const labels = task.labels || [];
  return (
    <>
      {due && (
        <span className={`${smallChip} ${U.DUE_TONE_CLASS[due.tone]}`}>
          <TI.Calendar className="w-3 h-3" />
          {due.text}
          {task.recurrence && <TI.Repeat className="w-3 h-3" aria-label="Tekrarlı" />}
        </span>
      )}
      {!due && task.recurrence && (
        <span className={`${smallChip} ${U.DUE_TONE_CLASS.future}`}><TI.Repeat className="w-3 h-3" />{U.recurrenceLabel(task.recurrence)}</span>
      )}
      {task.subtaskCount > 0 && (
        <span className={`${smallChip} border-transparent text-text-tertiary`} title="Alt görevler">
          <TI.Subtask className="w-3 h-3" />
          {task.subtaskDoneCount}/{task.subtaskCount}
        </span>
      )}
      {task.linkCount > 0 && (
        <span className={`${smallChip} border-transparent text-text-tertiary`} title="Bağlantılar">
          <TI.Link className="w-3 h-3" />
          {task.linkCount}
        </span>
      )}
      {(spent > 0 || isRunning) && (
        <span className={`${smallChip} ${isRunning ? 'border-accent/30 bg-accent/10 text-accent' : 'border-transparent text-text-tertiary'}`} title="Harcanan süre">
          <TI.Clock className="w-3 h-3" />
          {isRunning ? U.formatClock(spent) : U.formatDuration(spent)}
          {task.estimateMin ? <span className="opacity-70">/ {task.estimateMin} dk</span> : null}
        </span>
      )}
      {!compact && labels.map(l => (
        <span key={l.id} className={`${smallChip} bg-info/10 text-info border-info/20`} style={l.color ? { color: l.color, borderColor: `${l.color}55`, backgroundColor: `${l.color}1a` } : undefined}>
          <TI.Tag className="w-3 h-3" />{l.name}
        </span>
      ))}
      {compact && labels.length > 0 && (
        <span className={`${smallChip} bg-info/10 text-info border-info/20`} title={labels.map(l => l.name).join(', ')}>
          <TI.Tag className="w-3 h-3" />{labels.length}
        </span>
      )}
      {showProject && project && (
        <span className={`${smallChip} border-transparent text-text-tertiary ml-auto`}>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: project.color || '#64748b' }} />
          {project.name}
        </span>
      )}
    </>
  );
};

const TaskRow = ({
  task, project, selected, completing, isRunning, now, showProject, orphanSubtask,
  onToggle, onOpen, onDelete, onTimer, onSelect, drag,
}) => {
  const done = task.status === 'done' || completing;
  const pm = U.prio(task.priority);
  const pending = String(task.id).startsWith('tmp-');

  return (
    <div
      id={`task-row-${task.id}`}
      role="listitem"
      aria-selected={selected || undefined}
      onClick={() => { onSelect(task.id); onOpen(task); }}
      onMouseEnter={() => onSelect(task.id, true)}
      draggable={!!drag && !pending}
      onDragStart={drag ? (e) => drag.onDragStart(e, task) : undefined}
      onDragOver={drag ? (e) => drag.onDragOver(e, task) : undefined}
      onDrop={drag ? (e) => drag.onDrop(e, task) : undefined}
      onDragEnd={drag ? drag.onDragEnd : undefined}
      className={`group relative flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
        selected ? 'bg-bg-input/70 border-accent/40' : 'border-transparent hover:bg-bg-input/50'
      } ${pending ? 'opacity-60' : ''}`}
    >
      {drag && drag.dropTarget === String(task.id) && (
        <span className={`absolute left-2 right-2 h-0.5 bg-accent rounded ${drag.dropPos === 'after' ? '-bottom-px' : '-top-px'}`} />
      )}
      {drag && (
        <span className="absolute -left-1 top-3 text-text-muted opacity-0 group-hover:opacity-100 cursor-grab" aria-hidden="true">
          <TI.Grip className="w-3.5 h-3.5" />
        </span>
      )}
      <div className="pt-0.5">
        <AnimatedCheck
          checked={done}
          onChange={() => { if (!pending) onToggle(task); }}
          size={18}
          color={task.priority < 4 ? pm.color : 'rgb(var(--accent))'}
          aria-label={done ? 'Tamamlanmadı olarak işaretle' : 'Tamamla'}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {task.priority < 4 && <TI.Flag className={`w-3.5 h-3.5 flex-shrink-0 ${pm.text}`} aria-label={pm.label} />}
          <span className={`text-sm truncate transition-colors ${done ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>
            {task.title}
          </span>
          {orphanSubtask && <span className="text-[10px] text-text-muted flex-shrink-0">alt görev</span>}
        </div>
        {task.notes && !done && (
          <p className="text-xs text-text-tertiary truncate mt-0.5">{String(task.notes).split('\n')[0].replace(/[*#>`]/g, '')}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-1 empty:hidden">
          <TaskMeta task={task} project={project} showProject={showProject} isRunning={isRunning} now={now} />
        </div>
      </div>

      <div className={`flex items-center gap-0.5 flex-shrink-0 transition-opacity ${isRunning ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'} ${selected ? 'opacity-100' : ''}`}>
        {task.status !== 'done' && !pending && (
          <ActionBtn
            label={isRunning ? 'Zamanlayıcıyı durdur' : 'Zamanlayıcıyı başlat'}
            onClick={() => onTimer(task)}
            tone={isRunning ? 'text-accent bg-accent/10 hover:bg-accent/20' : undefined}
          >
            {isRunning ? <TI.Stop className="w-3.5 h-3.5" /> : <TI.Play className="w-3.5 h-3.5" />}
          </ActionBtn>
        )}
        <ActionBtn label="Düzenle (E)" onClick={() => onOpen(task)}><TI.Pencil className="w-3.5 h-3.5" /></ActionBtn>
        {!pending && (
          <ActionBtn label="Sil (Delete)" onClick={() => onDelete(task)} tone="text-text-tertiary hover:text-negative hover:bg-negative/10">
            <TI.Trash className="w-3.5 h-3.5" />
          </ActionBtn>
        )}
      </div>
    </div>
  );
};

const MemoRow = React.memo(TaskRow);
MemoRow.TaskMeta = TaskMeta;
module.exports = MemoRow;
