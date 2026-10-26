const React = require('react');
const { useEffect } = React;
const { FadeIn } = require('../ui/motion');

// Shared bits for the Finans page: input styles, modal, small icons, toast stack.

const inputCls = 'w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/70';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent text-accent-text text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity';
const btnGhost = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50';
const cardCls = 'bg-bg-surface border border-border rounded-xl';

const Svg = ({ children, className = 'w-4 h-4', ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...rest}>{children}</svg>
);
const I = {
  X: (p) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>,
  Plus: (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  Left: (p) => <Svg {...p}><path d="m15 18-6-6 6-6" /></Svg>,
  Right: (p) => <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>,
  Edit: (p) => <Svg {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>,
  Trash: (p) => <Svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>,
  Check: (p) => <Svg {...p}><path d="m5 12 5 5L20 7" /></Svg>,
  Alert: (p) => <Svg {...p}><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></Svg>,
  Upload: (p) => <Svg {...p}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></Svg>,
  Download: (p) => <Svg {...p}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></Svg>,
  Repeat: (p) => <Svg {...p}><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /></Svg>,
  Swap: (p) => <Svg {...p}><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" /></Svg>,
};

const Modal = ({ title, subtitle, onClose, children, wide }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <FadeIn y={6} className={`relative w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto bg-bg-surface border border-border rounded-xl shadow-2xl`}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-text-primary font-semibold text-base">{title}</h2>
            {subtitle && <p className="text-text-tertiary text-xs mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Kapat" className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-input">
            <I.X />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </FadeIn>
    </div>
  );
};

const Field = ({ label, children, hint }) => (
  <label className="block">
    <span className="block text-[11px] font-medium text-text-tertiary mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[10px] text-text-muted mt-1">{hint}</span>}
  </label>
);

const ToastStack = ({ toasts, onAction, onDismiss }) => (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[210] flex flex-col items-center gap-2 pointer-events-none w-[min(92vw,420px)]" aria-live="polite">
    {toasts.map((t) => (
      <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
        className={`pointer-events-auto w-full flex items-center gap-3 px-4 py-2.5 bg-bg-surface border rounded-xl shadow-2xl ${t.tone === 'error' ? 'border-negative/40' : 'border-border'}`}>
        {t.tone === 'error' ? <I.Alert className="w-4 h-4 text-negative flex-shrink-0" /> : <I.Check className="w-4 h-4 text-positive flex-shrink-0" />}
        <p className="flex-1 min-w-0 text-sm text-text-primary truncate" title={t.message}>{t.message}</p>
        {t.actionLabel && <button type="button" onClick={() => onAction(t.id)} className="text-xs font-semibold text-accent hover:underline flex-shrink-0">{t.actionLabel}</button>}
        <button type="button" onClick={() => onDismiss(t.id)} aria-label="Kapat" className="text-text-muted hover:text-text-primary flex-shrink-0"><I.X className="w-3.5 h-3.5" /></button>
      </div>
    ))}
  </div>
);

module.exports = { inputCls, btnPrimary, btnGhost, cardCls, I, Modal, Field, ToastStack };
