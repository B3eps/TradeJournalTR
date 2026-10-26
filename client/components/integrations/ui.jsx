// Shared building blocks for the Bağlantılar sections: card, status pill,
// toggle, field, banners, save button and a copyable path/code box.
const React = require('react');
const { useState, useEffect, useRef } = React;
const { motion, AnimatePresence } = require('framer-motion');
const { useAnimationsEnabled } = require('../ui/motion');
const sound = require('../../utils/sound');

const svgProps = (p) => ({
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...p,
});
const Icon = {
  Phone: (p) => (<svg {...svgProps(p)}><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>),
  Archive: (p) => (<svg {...svgProps(p)}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>),
  Chip: (p) => (<svg {...svgProps(p)}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></svg>),
  Google: (p) => (<svg {...svgProps(p)}><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 12h-8" /></svg>),
  Check: (p) => (<svg {...svgProps(p)}><path d="M5 12l5 5L20 7" /></svg>),
  Copy: (p) => (<svg {...svgProps(p)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>),
  Alert: (p) => (<svg {...svgProps(p)}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>),
  Info: (p) => (<svg {...svgProps(p)}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>),
  Trash: (p) => (<svg {...svgProps(p)}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>),
  Folder: (p) => (<svg {...svgProps(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>),
};

const PILL_TONES = {
  ok: 'bg-positive/10 text-positive border-positive/30',
  warn: 'bg-warning/10 text-warning border-warning/30',
  error: 'bg-negative/10 text-negative border-negative/30',
  off: 'bg-bg-input text-text-tertiary border-border',
  info: 'bg-info/10 text-info border-info/30',
};

const StatusPill = ({ tone = 'off', children }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium whitespace-nowrap ${PILL_TONES[tone] || PILL_TONES.off}`}>
    <span className="w-1.5 h-1.5 rounded-full bg-current" />
    {children}
  </span>
);

const SectionCard = ({ icon, title, subtitle, pill, children }) => (
  <section className="bg-bg-surface border border-border rounded-2xl">
    <header className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-border">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">{icon}</div>
        <div className="min-w-0">
          <h2 className="text-text-primary font-semibold text-base leading-tight">{title}</h2>
          {subtitle && <p className="text-text-tertiary text-xs mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {pill}
    </header>
    <div className="px-5 sm:px-6 py-5 space-y-5">{children}</div>
  </section>
);

const Toggle = ({ checked, onChange, label, description, disabled }) => {
  const on = useAnimationsEnabled();
  const flip = () => {
    if (disabled) return;
    sound.play(checked ? 'toggle-off' : 'toggle-on');
    onChange(!checked);
  };
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-text-primary font-medium">{label}</div>
        {description && <div className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={label}
        disabled={disabled}
        onClick={flip}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 ${checked ? 'bg-accent border-accent' : 'bg-bg-input border-border'}`}
      >
        <motion.span
          className="absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full bg-white shadow"
          initial={false}
          animate={{ x: checked ? 20 : 0 }}
          transition={on ? { type: 'spring', stiffness: 500, damping: 32 } : { duration: 0 }}
        />
      </button>
    </div>
  );
};

const inputCls = 'w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/70 disabled:opacity-50';

const Field = ({ label, hint, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-xs font-medium text-text-secondary mb-1.5">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-text-tertiary mt-1 leading-relaxed">{hint}</span>}
  </label>
);

const Banner = ({ tone = 'error', children, onClose }) => {
  const tones = {
    error: 'bg-negative/10 border-negative/30 text-negative',
    warn: 'bg-warning/10 border-warning/30 text-warning',
    info: 'bg-info/10 border-info/30 text-text-secondary',
    ok: 'bg-positive/10 border-positive/30 text-positive',
  };
  const I = tone === 'info' ? Icon.Info : tone === 'ok' ? Icon.Check : Icon.Alert;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 border rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${tones[tone] || tones.info}`}>
      <I width={16} height={16} className="flex-shrink-0 mt-px" />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="opacity-70 hover:opacity-100 text-sm leading-none" aria-label="Kapat">×</button>
      )}
    </div>
  );
};

const btnBase = 'inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
const Button = ({ variant = 'secondary', className = '', children, ...rest }) => {
  const v = {
    primary: 'bg-accent text-accent-text font-semibold hover:brightness-110',
    secondary: 'bg-bg-input border border-border text-text-primary hover:border-text-tertiary',
    ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-input',
    danger: 'text-negative hover:bg-negative/10',
  }[variant];
  return <button type="button" className={`${btnBase} ${v} ${className}`} {...rest}>{children}</button>;
};

// Save button that briefly shows "Kaydedildi" after a successful save.
const SaveButton = ({ onSave, disabled }) => {
  const [state, setState] = useState('idle');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = async () => {
    setState('saving');
    const ok = await onSave();
    if (ok) {
      sound.play('complete', { volume: 0.6 });
      setState('saved');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 1800);
    } else {
      sound.play('error');
      setState('idle');
    }
  };
  return (
    <Button variant="primary" onClick={click} disabled={disabled || state === 'saving'} className="min-w-[112px]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="inline-flex items-center gap-1.5"
        >
          {state === 'saved' && <Icon.Check width={15} height={15} />}
          {state === 'saving' ? 'Kaydediliyor…' : state === 'saved' ? 'Kaydedildi' : 'Kaydet'}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
};

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
};

const CopyBox = ({ value, mono = true }) => {
  const [copied, setCopied] = useState(false);
  const click = async () => {
    if (await copyText(value)) {
      sound.play('pop', { volume: 0.5 });
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };
  return (
    <div className="flex items-stretch gap-2">
      <code className={`flex-1 min-w-0 bg-bg-input border border-border rounded-lg px-3 py-2 text-xs text-text-primary break-all ${mono ? 'font-mono' : ''}`}>{value}</code>
      <Button variant="secondary" onClick={click} aria-label="Kopyala" className="px-3">
        {copied ? <Icon.Check width={15} height={15} /> : <Icon.Copy width={15} height={15} />}
        <span className="hidden sm:inline">{copied ? 'Kopyalandı' : 'Kopyala'}</span>
      </Button>
    </div>
  );
};

const Steps = ({ items }) => (
  <ol className="space-y-2 text-xs text-text-secondary leading-relaxed">
    {items.map((it, i) => (
      <li key={i} className="flex gap-2.5">
        <span className="w-5 h-5 rounded-full bg-bg-input border border-border text-[11px] text-text-secondary flex items-center justify-center flex-shrink-0">{i + 1}</span>
        <span className="min-w-0 pt-0.5">{it}</span>
      </li>
    ))}
  </ol>
);

const Skeleton = () => (
  <div className="space-y-3 animate-pulse">
    <div className="h-4 bg-bg-input rounded w-1/3" />
    <div className="h-9 bg-bg-input rounded" />
    <div className="h-9 bg-bg-input rounded w-2/3" />
  </div>
);

const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
};

const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

module.exports = {
  Icon, StatusPill, SectionCard, Toggle, Field, Banner, Button, SaveButton, CopyBox, Steps, Skeleton,
  inputCls, fmtBytes, fmtDateTime, copyText,
};
