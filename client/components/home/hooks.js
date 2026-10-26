// Data hook: fetch on mount, refresh every `interval` ms while the tab is visible.
const React = require('react');
const { useState, useEffect, useRef, useCallback } = React;

const useResource = (fetcher, interval = 60000) => {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const alive = useRef(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    try {
      const data = await fetcherRef.current();
      if (alive.current && id === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (alive.current && id === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    const t = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') reload();
    }, interval);
    const onVis = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive.current = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [reload, interval]);

  const mutate = useCallback((fn) => setState((s) => ({ ...s, data: fn(s.data) })), []);
  return { ...state, reload, mutate };
};

// Re-render every `ms` (for countdowns / running timers).
const useNow = (ms = 1000, active = true) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
};

module.exports = { useResource, useNow };
