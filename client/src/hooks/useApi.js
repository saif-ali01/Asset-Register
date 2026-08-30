import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Fetches a path and re-runs when `params` changes. Stale responses are
 * discarded, so fast typing in a search box can't paint older results.
 */
export function useApi(path, params, { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const key = JSON.stringify(params ?? {});
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !path) return;
    const ticket = ++seq.current;
    setLoading(true);
    try {
      const result = await api.get(path, JSON.parse(key));
      if (ticket === seq.current) { setData(result); setError(null); }
    } catch (err) {
      if (ticket === seq.current) setError(err);
    } finally {
      if (ticket === seq.current) setLoading(false);
    }
  }, [path, key, enabled]);

  useEffect(() => { load(); }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
