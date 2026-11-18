import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Like useApi, but refreshes in the background: { data, loading, error, reload, refresh }.
 * While `shouldPoll(data)` is true it refetches every `intervalMs` without showing the
 * loading state again, so a running build updates in place.
 * `fetcher` must be stable (wrap it in useCallback).
 */
export default function usePolling(fetcher, { intervalMs = 3000, shouldPoll = () => false } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const shouldPollRef = useRef(shouldPoll);
  shouldPollRef.current = shouldPoll;
  const cancelledRef = useRef(false);

  const refresh = useCallback(
    () =>
      fetcher()
        .then((data) => {
          if (!cancelledRef.current) setState({ data, loading: false, error: null });
        })
        .catch((error) => {
          // Keep showing what we had; a failed background refresh only replaces an empty page.
          if (!cancelledRef.current) setState((prev) => (prev.data ? prev : { data: null, loading: false, error }));
        }),
    [fetcher],
  );

  useEffect(() => {
    cancelledRef.current = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh, attempt]);

  const polling = !state.loading && !state.error && shouldPollRef.current(state.data);
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [polling, refresh, intervalMs]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, reload, refresh };
}
