// Minimal accessible modal used by the Kartlar dialogs (Esc / backdrop closes).
const React = require('react');
const { useEffect } = React;
const { motion } = require('framer-motion');
const { useAnimationsEnabled } = require('../ui/motion');
const CI = require('./CardIcons');

const Modal = ({ title, onClose, children, footer, wide = false }) => {
  const animate = useAnimationsEnabled();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <motion.div
        className="absolute inset-0 bg-black/60"
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: animate ? 0.15 : 0 }}
        onClick={onClose}
      />
      <motion.div
        className={`relative w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] flex flex-col bg-bg-surface border border-border rounded-2xl shadow-2xl`}
        initial={animate ? { opacity: 0, y: 12, scale: 0.98 } : false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: animate ? 0.18 : 0 }}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Kapat" className="text-text-muted hover:text-text-primary">
            <CI.X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2">{footer}</div>}
      </motion.div>
    </div>
  );
};

module.exports = Modal;
