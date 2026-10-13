import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';

/**
 * Fetch one analytics endpoint with:
 *  - loading / error / data states
 *  - a manual `reload()` for the Refresh button and Retry actions
 *  - a stale-response guard: every request gets a sequence number and a late
 *    response from an older filter selection is dropped, so switching filters
 *    quickly can never overwrite newer results.
 *
 * While a refetch is in flight the previous data stays visible (marked
 * "Updating…") so charts do not flash empty.
 */
export function useAnalytics(url, refreshKey = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.get(url);
      if (id !== seq.current) return; // stale — a newer request is already running
      setState({ data: res.data, loading: false, error: null });
    } catch (err) {
      if (id !== seq.current) return;
      setState((s) => ({ data: s.data, loading: false, error: err.message || 'Request failed' }));
    }
  }, [url]);

  useEffect(() => {
    load();
    return () => { seq.current += 1; }; // unmount/invalidate in-flight work
  }, [load, refreshKey]);

  return { ...state, reload: load };
}
