/*
 * UI sound engine (no audio files).
 *
 * Every sound is synthesized with the Web Audio API: oscillators and a cached
 * white-noise buffer, shaped by gain envelopes and filters. A single
 * AudioContext is created lazily (on the first user gesture, or on the first
 * play() call) and every function is a no-op when Web Audio is unavailable.
 *
 *   const sound = require('../utils/sound');
 *   sound.play('complete');            // task done
 *   sound.play('whoosh', { volume: 0.3 }); // per-call gain multiplier 0..1
 *   const { play, enabled, volume } = sound.useSound(); // React hook
 *
 * Sounds: click, toggle-on, toggle-off, pop, complete, complete-all, error,
 * notify, alert, whoosh, start, stop, delete.
 * Settings persist in localStorage: 'ui-sound-enabled', 'ui-sound-volume'.
 */
const React = require('react');

const ENABLED_KEY = 'ui-sound-enabled';
const VOLUME_KEY = 'ui-sound-volume';
const DEFAULT_VOLUME = 0.35;
const MIN_GAP_MS = 40;

const hasWindow = typeof window !== 'undefined';

const readStorage = (key) => {
  try { return hasWindow ? window.localStorage.getItem(key) : null; } catch { return null; }
};
const writeStorage = (key, value) => {
  try { if (hasWindow) window.localStorage.setItem(key, value); } catch { /* ignore */ }
};

let enabled = readStorage(ENABLED_KEY) !== 'false';
let volume = (() => {
  const v = parseFloat(readStorage(VOLUME_KEY));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
})();

const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn({ enabled, volume }); } catch { /* ignore */ } });

let ctx = null;
let master = null;
let noiseBuffer = null;
let unavailable = false;
const lastPlayed = {};

const getCtx = () => {
  if (unavailable || !hasWindow) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { unavailable = true; return null; }
      ctx = new AC();
      // Gentle limiter so overlapping sounds never clip.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    return ctx;
  } catch {
    unavailable = true;
    return null;
  }
};

// Unlock audio on the first user gesture (browsers require it).
if (hasWindow) {
  const unlock = () => {
    getCtx();
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

const getNoise = (ac) => {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ac.sampleRate * 1);
  noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
};

/* ── Building blocks ─────────────────────────────────────────── */

// One enveloped oscillator note.
const tone = (ac, out, {
  freq = 440, freqEnd = null, type = 'sine', start = 0, dur = 0.12,
  attack = 0.005, peak = 0.3, filter = null, q = 0.7, detune = 0,
}) => {
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = osc;
  if (filter) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    f.Q.value = q;
    osc.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
};

// Filtered noise burst, optionally sweeping the filter.
const noise = (ac, out, {
  start = 0, dur = 0.2, peak = 0.2, attack = 0.02, type = 'bandpass',
  from = 800, to = 800, q = 1,
}) => {
  const t0 = ac.currentTime + start;
  const src = ac.createBufferSource();
  src.buffer = getNoise(ac);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.03);
};

// Soft "chime" note: sine fundamental + quiet triangle octave.
const chime = (ac, out, freq, start, dur = 0.32, peak = 0.22) => {
  tone(ac, out, { freq, type: 'sine', start, dur, attack: 0.006, peak });
  tone(ac, out, { freq: freq * 2, type: 'triangle', start, dur: dur * 0.6, attack: 0.004, peak: peak * 0.18, filter: 5000 });
};

/* ── Sound library ───────────────────────────────────────────── */

const SOUNDS = {
  click: (ac, out) => {
    tone(ac, out, { freq: 1700, freqEnd: 1100, type: 'triangle', dur: 0.035, attack: 0.002, peak: 0.16, filter: 4000 });
  },
  'toggle-on': (ac, out) => {
    tone(ac, out, { freq: 620, freqEnd: 760, type: 'sine', dur: 0.06, peak: 0.2 });
    tone(ac, out, { freq: 930, type: 'sine', start: 0.055, dur: 0.09, peak: 0.18 });
  },
  'toggle-off': (ac, out) => {
    tone(ac, out, { freq: 900, freqEnd: 760, type: 'sine', dur: 0.06, peak: 0.18 });
    tone(ac, out, { freq: 560, type: 'sine', start: 0.055, dur: 0.09, peak: 0.16 });
  },
  pop: (ac, out) => {
    tone(ac, out, { freq: 380, freqEnd: 920, type: 'sine', dur: 0.09, attack: 0.003, peak: 0.26, filter: 3000 });
    noise(ac, out, { dur: 0.03, peak: 0.04, from: 3000, to: 2000, attack: 0.002 });
  },
  complete: (ac, out) => {
    chime(ac, out, 659.25, 0, 0.26, 0.2);    // E5
    chime(ac, out, 987.77, 0.085, 0.34, 0.2); // B5
  },
  'complete-all': (ac, out) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => chime(ac, out, f, i * 0.07, i === 3 ? 0.4 : 0.24, 0.17));
  },
  error: (ac, out) => {
    // Fundamental kept >= 400 Hz so laptop/phone speakers can reproduce it.
    tone(ac, out, { freq: 520, freqEnd: 460, type: 'triangle', dur: 0.085, peak: 0.22, filter: 1800 });
    tone(ac, out, { freq: 440, freqEnd: 400, type: 'triangle', start: 0.12, dur: 0.11, peak: 0.22, filter: 1800 });
  },
  notify: (ac, out) => {
    // Small bell: fundamental + inharmonic partial, quick decay.
    tone(ac, out, { freq: 1318.5, type: 'sine', dur: 0.4, attack: 0.004, peak: 0.16 });
    tone(ac, out, { freq: 1318.5 * 2.76, type: 'sine', dur: 0.18, attack: 0.002, peak: 0.035 });
    tone(ac, out, { freq: 659.25, type: 'sine', dur: 0.3, attack: 0.006, peak: 0.06 });
  },
  alert: (ac, out) => {
    // Two distinct tones, clearly noticeable but rounded off by a lowpass.
    tone(ac, out, { freq: 1046.5, type: 'triangle', dur: 0.14, attack: 0.006, peak: 0.24, filter: 2800 });
    tone(ac, out, { freq: 784, type: 'triangle', start: 0.16, dur: 0.2, attack: 0.006, peak: 0.24, filter: 2400 });
  },
  whoosh: (ac, out) => {
    noise(ac, out, { dur: 0.26, peak: 0.16, attack: 0.08, type: 'bandpass', from: 450, to: 2600, q: 0.9 });
  },
  start: (ac, out) => {
    tone(ac, out, { freq: 523.25, type: 'sine', dur: 0.09, peak: 0.2 });
    tone(ac, out, { freq: 783.99, type: 'sine', start: 0.075, dur: 0.16, peak: 0.2 });
  },
  stop: (ac, out) => {
    tone(ac, out, { freq: 783.99, type: 'sine', dur: 0.09, peak: 0.2 });
    tone(ac, out, { freq: 523.25, type: 'sine', start: 0.075, dur: 0.18, peak: 0.2 });
  },
  delete: (ac, out) => {
    tone(ac, out, { freq: 620, freqEnd: 280, type: 'sine', dur: 0.18, attack: 0.004, peak: 0.2, filter: 2200 });
    noise(ac, out, { dur: 0.08, peak: 0.035, type: 'lowpass', from: 2400, to: 600, attack: 0.003 });
  },
};

/* ── Public API ──────────────────────────────────────────────── */

const play = (name, opts = {}) => {
  try {
    if (!enabled || volume <= 0) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const now = Date.now();
    if (lastPlayed[name] && now - lastPlayed[name] < MIN_GAP_MS) return;
    lastPlayed[name] = now;
    const ac = getCtx();
    if (!ac || !master) return;
    let out = master;
    const mult = typeof opts.volume === 'number' ? Math.min(1, Math.max(0, opts.volume)) : 1;
    if (mult !== 1) {
      out = ac.createGain();
      out.gain.value = mult;
      out.connect(master);
      setTimeout(() => { try { out.disconnect(); } catch { /* ignore */ } }, 1500);
    }
    fn(ac, out);
  } catch {
    /* audio must never break the UI */
  }
};

const setVolume = (v) => {
  const n = Number(v);
  volume = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_VOLUME;
  writeStorage(VOLUME_KEY, String(volume));
  try { if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02); } catch { /* ignore */ }
  emit();
};

const setEnabled = (v) => {
  enabled = !!v;
  writeStorage(ENABLED_KEY, String(enabled));
  emit();
};

const isEnabled = () => enabled;
const getVolume = () => volume;

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const SOUND_NAMES = Object.keys(SOUNDS);

// React hook: re-renders when sound settings change.
const useSound = () => {
  const en = React.useSyncExternalStore(subscribe, isEnabled, isEnabled);
  const vol = React.useSyncExternalStore(subscribe, getVolume, getVolume);
  return { play, enabled: en, volume: vol, setEnabled, setVolume };
};

module.exports = { play, setVolume, setEnabled, isEnabled, getVolume, subscribe, useSound, SOUND_NAMES };
