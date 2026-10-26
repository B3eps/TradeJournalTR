// Slim "Odak" bar shown while a task timer is running.
const React = require('react');
const TI = require('./TaskIcons');
const U = require('./taskUtils');

const FocusBar = ({ task, now, onStop, onOpen }) => {
  if (!task) return null;
  const session = U.sessionSeconds(task, now);
  const total = U.totalSpent(task, now);
  const est = Number(task.estimateMin) || 0;
  return (
    <div
      role="status"
      aria-live="off"
      className="sticky top-0 z-20 flex items-center gap-3 bg-bg-surface/95 backdrop-blur border border-accent/40 rounded-xl px-4 py-2 shadow-lg"
    >
      <span className="relative flex w-2.5 h-2.5 flex-shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping motion-reduce:animate-none" />
        <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-accent" />
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-accent flex-shrink-0">Odak</span>
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="flex-1 min-w-0 text-left text-sm text-text-primary truncate hover:text-accent transition-colors"
        title="Görevi aç"
      >
        {task.title}
      </button>
      <span className="font-mono text-base font-semibold text-text-primary tabular-nums" aria-label="Bu oturumda geçen süre">
        {U.formatClock(session)}
      </span>
      <span className="hidden sm:inline text-[11px] text-text-muted whitespace-nowrap">
        Toplam {U.formatDuration(total)}{est ? ` / ${est} dk` : ''}
      </span>
      <button
        type="button"
        onClick={() => onStop(task)}
        className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-accent text-accent-text hover:bg-accent/90 transition-colors flex-shrink-0"
      >
        <TI.Stop className="w-3 h-3" />
        Durdur
      </button>
    </div>
  );
};

module.exports = FocusBar;
