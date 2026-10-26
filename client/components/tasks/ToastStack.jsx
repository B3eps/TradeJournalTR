// Undo / error toasts for the Tasks page (timers are owned by the page).
const React = require('react');
const { AnimatePresence, motion } = require('framer-motion');
const { useAnimationsEnabled } = require('../ui/motion');
const TI = require('./TaskIcons');

const ToastStack = ({ toasts, onAction, onDismiss }) => {
  const animate = useAnimationsEnabled();
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[210] flex flex-col items-center gap-2 pointer-events-none w-[min(92vw,420px)]" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            layout={animate}
            initial={animate ? { opacity: 0, y: 16, scale: 0.98 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={animate ? { opacity: 0, y: 8, scale: 0.98 } : { opacity: 0 }}
            transition={{ duration: animate ? 0.18 : 0 }}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto w-full overflow-hidden bg-bg-surface border rounded-xl shadow-2xl ${t.tone === 'error' ? 'border-negative/40' : 'border-border'}`}
          >
            <div className="flex items-center gap-3 px-4 py-2.5">
              {t.tone === 'error'
                ? <TI.Alert className="w-4 h-4 text-negative flex-shrink-0" />
                : <TI.Check className="w-4 h-4 text-positive flex-shrink-0" />}
              <p className="flex-1 min-w-0 text-sm text-text-primary truncate" title={t.message}>{t.message}</p>
              {t.actionLabel && (
                <button
                  type="button"
                  onClick={() => onAction(t.id)}
                  className="text-xs font-semibold text-accent hover:underline flex-shrink-0"
                >
                  {t.actionLabel}
                </button>
              )}
              <button type="button" onClick={() => onDismiss(t.id)} aria-label="Kapat" className="text-text-muted hover:text-text-primary flex-shrink-0">
                <TI.X className="w-3.5 h-3.5" />
              </button>
            </div>
            {t.actionLabel && (
              <div className="h-0.5 bg-bg-input">
                <div
                  className="h-full bg-accent/70"
                  style={{ width: '100%', animation: `tasks-toast-shrink ${t.duration}ms linear forwards` }}
                />
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <style>{'@keyframes tasks-toast-shrink { from { width: 100%; } to { width: 0%; } }'}</style>
    </div>
  );
};

module.exports = ToastStack;
