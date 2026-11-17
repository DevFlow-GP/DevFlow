import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../services/api';

const SessionContext = createContext(null);

/** Users who signed up without a company still get a workspace to show in the UI. */
function personalWorkspace(user) {
  return { slug: 'personal', name: 'Personal', initials: user.initials, cluster: null };
}

/**
 * Shares the signed-in user (or null for guests) and their workspace app-wide.
 * The access token is kept by services/api.js; on load, a stored token is
 * exchanged for the user via GET /session.
 *
 * status: 'guest' | 'loading' | 'ready' | 'error' (backend unreachable)
 */
export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(() => (tokenStore.get() ? 'loading' : 'guest'));
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const signOut = useCallback(() => {
    tokenStore.set(null);
    setSession(null);
    setError(null);
    setStatus('guest');
  }, []);

  // An expired or revoked token anywhere in the app ends the session.
  useEffect(() => {
    setUnauthorizedHandler(signOut);
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // Restore the session from a stored token (page load, or Retry after an error).
  useEffect(() => {
    if (!tokenStore.get()) return undefined;
    let cancelled = false;
    setStatus('loading');
    api
      .getSession()
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled || err.status === 401) return; // 401 already signed out
        setError(err);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /** Stores the token from login/register, then loads the session. Rejects with an ApiError. */
  const startSession = useCallback(async ({ access_token: token }) => {
    tokenStore.set(token);
    try {
      setSession(await api.getSession());
      setError(null);
      setStatus('ready');
    } catch (err) {
      tokenStore.set(null);
      setStatus('guest');
      throw err;
    }
  }, []);

  const signIn = useCallback(
    async ({ email, password }) => startSession(await api.login({ email, password })),
    [startSession],
  );

  const signUp = useCallback(
    async ({ name, email, password, companyName }) =>
      startSession(await api.register({ name, email, password, companyName })),
    [startSession],
  );

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(() => {
    const user = session?.user ?? null;
    return {
      user,
      isAuthenticated: Boolean(user),
      workspace: user ? (session.workspace ?? personalWorkspace(user)) : null,
      loading: status === 'loading',
      error: status === 'error' ? error : null,
      reload,
      signIn,
      signUp,
      signOut,
    };
  }, [session, status, error, reload, signIn, signUp, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
