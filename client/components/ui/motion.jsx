/*
 * Animation primitives (framer-motion). All of them respect BOTH the OS
 * "prefers-reduced-motion" setting and the in-app toggle stored in
 * localStorage 'ui-animations' ('false' = off). When motion is off they
 * render their final state immediately.
 *
 *   const { FadeIn, Stagger, StaggerItem, CountUp, HoverLift, PageTransition,
 *           AnimatedCheck, ProgressRing, Bar, useAnimationsEnabled } = require('../ui/motion');
 *
 *   <FadeIn delay={0.1} y={8}>...</FadeIn>              fade + slide up on mount
 *   <Stagger stagger={0.05}>                             list/card container
 *     {items.map(i => <StaggerItem key={i.id}>...</StaggerItem>)}
 *   </Stagger>
 *   <CountUp value={1234.5} duration={600} format={n => n.toFixed(2)} />  (duration in ms)
 *   <HoverLift className="rounded-xl border ...">card</HoverLift>   -2px + shadow on hover
 *   <PageTransition pageId={page}>{page content}</PageTransition>  (used by trades.jsx)
 *   <AnimatedCheck checked={done} onChange={setDone} size={18} sound />  draw-the-check checkbox
 *   <ProgressRing value={72} size={48} stroke={5} color="rgb(var(--positive))">72%</ProgressRing>
 *   <Bar value={40} color="rgb(var(--accent))" height={6} />           value is 0..100
 *
 *   const animate = useAnimationsEnabled();     // effective (pref AND not reduced-motion)
 *   const [pref, setPref] = useAnimationPreference(); // raw in-app toggle
 *
 * PageTransition and HoverLift use CSS keyframes/transitions (globals.css) instead
 * of inline transforms so position:fixed descendants (modals, side panels) are
 * never trapped in a transformed containing block after the animation ends.
 */
const React = require('react');
const { useEffect, useRef, useState, useSyncExternalStore } = React;
const { motion } = require('framer-motion');
const { cn } = require('../../lib/utils');

/* ── Animations store ────────────────────────────────────────── */

const ANIM_KEY = 'ui-animations';
const hasWindow = typeof window !== 'undefined';

let animPref = (() => {
  try { return window.localStorage.getItem(ANIM_KEY) !== 'false'; } catch { return true; }
})();
const animListeners = new Set();

const applyDocAttr = () => {
  try { document.documentElement.setAttribute('data-animations', animPref ? 'on' : 'off'); } catch { /* ignore */ }
};
if (hasWindow) applyDocAttr();

const getAnimationsPreference = () => animPref;
const setAnimationsEnabled = (v) => {
  animPref = !!v;
  try { window.localStorage.setItem(ANIM_KEY, String(animPref)); } catch { /* ignore */ }
  applyDocAttr();
  animListeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
};
const subscribeAnimations = (fn) => { animListeners.add(fn); return () => animListeners.delete(fn); };

const mq = hasWindow && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const getSystemReduced = () => (mq ? mq.matches : false);
const subscribeSystem = (fn) => {
  if (!mq) return () => {};
  if (mq.addEventListener) { mq.addEventListener('change', fn); return () => mq.removeEventListener('change', fn); }
  mq.addListener(fn); return () => mq.removeListener(fn);
};

// Non-hook check, e.g. inside event handlers.
const shouldAnimate = () => animPref && !getSystemReduced();

// Effective flag: in-app toggle ON and OS not asking for reduced motion.
const useAnimationsEnabled = () => {
  const pref = useSyncExternalStore(subscribeAnimations, getAnimationsPreference, () => true);
  const reduced = useSyncExternalStore(subscribeSystem, getSystemReduced, () => false);
  return pref && !reduced;
};

// Raw in-app preference (for settings UIs).
const useAnimationPreference = () => {
  const pref = useSyncExternalStore(subscribeAnimations, getAnimationsPreference, () => true);
  return [pref, setAnimationsEnabled];
};

const EASE = [0.22, 0.61, 0.36, 1];

const motionTag = (as) => (as && motion[as]) || motion.div;

/* ── FadeIn ──────────────────────────────────────────────────── */

const FadeIn = ({ children, delay = 0, y = 8, duration = 0.25, as = 'div', className, ...rest }) => {
  const on = useAnimationsEnabled();
  if (!on) {
    const Tag = as;
    return <Tag className={className} {...rest}>{children}</Tag>;
  }
  const M = motionTag(as);
  return (
    <M
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </M>
  );
};

/* ── Stagger / StaggerItem ───────────────────────────────────── */

const StaggerItemContext = React.createContext(false);

const Stagger = ({ children, stagger = 0.05, delay = 0, as = 'div', className, ...rest }) => {
  const on = useAnimationsEnabled();
  if (!on) {
    const Tag = as;
    return <Tag className={className} {...rest}>{children}</Tag>;
  }
  const M = motionTag(as);
  return (
    <StaggerItemContext.Provider value={true}>
      <M
        className={className}
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
        {...rest}
      >
        {children}
      </M>
    </StaggerItemContext.Provider>
  );
};

const StaggerItem = ({ children, y = 8, duration = 0.25, as = 'div', className, ...rest }) => {
  const on = useAnimationsEnabled();
  const inStagger = React.useContext(StaggerItemContext);
  if (!on) {
    const Tag = as;
    return <Tag className={className} {...rest}>{children}</Tag>;
  }
  const M = motionTag(as);
  const variants = {
    hidden: { opacity: 0, y },
    show: { opacity: 1, y: 0, transition: { duration, ease: EASE } },
  };
  // Outside a <Stagger> the item animates on its own.
  const own = inStagger ? {} : { initial: 'hidden', animate: 'show' };
  return (
    <M className={className} variants={variants} {...own} {...rest}>
      {children}
    </M>
  );
};

/* ── CountUp ─────────────────────────────────────────────────── */

const defaultFormat = (n) => Math.round(n).toLocaleString('tr-TR');

const CountUp = ({ value, duration = 600, format = defaultFormat, from = 0, className, ...rest }) => {
  const on = useAnimationsEnabled();
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(on ? Number(from) || 0 : target);
  const currentRef = useRef(display);

  useEffect(() => {
    if (!on) { currentRef.current = target; setDisplay(target); return undefined; }
    const start = currentRef.current;
    if (start === target) { setDisplay(target); return undefined; }
    const ms = Math.max(0, duration);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const p = ms === 0 ? 1 : Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (target - start) * eased;
      currentRef.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, on, duration]);

  return (
    <span className={cn('tabular-nums', className)} {...rest}>
      {format(display)}
    </span>
  );
};

/* ── HoverLift ───────────────────────────────────────────────── */

const HoverLift = ({ children, as = 'div', className, ...rest }) => {
  const Tag = as;
  return <Tag className={cn('ui-hover-lift', className)} {...rest}>{children}</Tag>;
};

/* ── PageTransition ──────────────────────────────────────────── */

// Keyed by pageId so each page switch replays a 220ms fade + slide. The page
// tree mounts/unmounts exactly as without the wrapper (no exit delay).
const PageTransition = ({ pageId, children, className }) => (
  <div key={pageId} className={cn('ui-page-enter', className)}>
    {children}
  </div>
);

/* ── AnimatedCheck ───────────────────────────────────────────── */

const AnimatedCheck = ({
  checked = false, onChange, size = 18, color = 'rgb(var(--accent))', checkColor = 'rgb(var(--accent-text))',
  disabled = false, pulse = true, sound = false, className, label, ...rest
}) => {
  const on = useAnimationsEnabled();
  const toggle = (e) => {
    e.stopPropagation();
    if (disabled) return;
    const next = !checked;
    if (sound) {
      try {
        const s = require('../../utils/sound');
        s.play(typeof sound === 'string' ? sound : (next ? 'complete' : 'toggle-off'));
      } catch { /* ignore */ }
    }
    if (onChange) onChange(next, e);
  };
  const box = (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={rest['aria-label'] || label}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        'relative inline-flex flex-shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer',
        !checked && 'border-text-tertiary/70 bg-bg-input hover:border-text-secondary',
        !label && className
      )}
      style={{ width: size, height: size, backgroundColor: checked ? color : undefined, borderColor: checked ? color : undefined }}
      initial={false}
      animate={on && pulse ? (checked ? { scale: [1, 1.18, 1] } : { scale: 1 }) : undefined}
      transition={{ duration: 0.28, ease: EASE }}
      whileTap={on ? { scale: 0.9 } : undefined}
    >
      <svg viewBox="0 0 16 16" width={size * 0.72} height={size * 0.72} fill="none" aria-hidden="true">
        <motion.path
          d="M3.5 8.4 L6.6 11.3 L12.5 4.9"
          stroke={checkColor}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={on ? { duration: 0.22, ease: EASE } : { duration: 0 }}
        />
      </svg>
    </motion.button>
  );
  if (!label) return box;
  return (
    <label className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}>
      {box}
      <span className={cn('text-sm transition-colors', checked ? 'text-text-tertiary line-through' : 'text-text-primary')}>{label}</span>
    </label>
  );
};

/* ── ProgressRing ────────────────────────────────────────────── */

const clampPct = (v) => Math.min(100, Math.max(0, Number(v) || 0));

const ProgressRing = ({
  value = 0, size = 48, stroke = 5, color = 'rgb(var(--accent))', trackColor = 'rgb(var(--border))',
  duration = 0.8, children, className, ...rest
}) => {
  const on = useAnimationsEnabled();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clampPct(value) / 100);
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }} {...rest}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: on ? c : offset }}
          animate={{ strokeDashoffset: offset }}
          transition={on ? { duration, ease: EASE } : { duration: 0 }}
        />
      </svg>
      {children != null && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-text-primary">
          {children}
        </div>
      )}
    </div>
  );
};

/* ── Bar ─────────────────────────────────────────────────────── */

const Bar = ({ value = 0, color = 'rgb(var(--accent))', height = 6, duration = 0.6, className, trackClassName, ...rest }) => {
  const on = useAnimationsEnabled();
  const pct = clampPct(value);
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-bg-input', trackClassName, className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...rest}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: on ? '0%' : `${pct}%` }}
        animate={{ width: `${pct}%` }}
        transition={on ? { duration, ease: EASE } : { duration: 0 }}
      />
    </div>
  );
};

const Motion = {
  FadeIn,
  Stagger,
  StaggerItem,
  CountUp,
  HoverLift,
  PageTransition,
  AnimatedCheck,
  ProgressRing,
  Bar,
  useAnimationsEnabled,
  useAnimationPreference,
  setAnimationsEnabled,
  getAnimationsPreference,
  shouldAnimate,
  EASE,
};

module.exports = { ...Motion, default: Motion };
