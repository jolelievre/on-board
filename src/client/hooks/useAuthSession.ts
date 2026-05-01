import { useEffect, useRef } from "react";
import { authClient } from "../lib/auth-client";

const CACHE_KEY = "onboard_session_cache";

type CachedSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
  expiresAt?: string;
};

function readCache(): CachedSession | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedSession;
  } catch {
    return null;
  }
}

function writeCache(session: CachedSession) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(session));
  } catch {
    // localStorage full — non-fatal
  }
}

export function clearSessionCache() {
  localStorage.removeItem(CACHE_KEY);
}

/**
 * Offline-safe wrapper around authClient.useSession().
 *
 * When online the real session is used and persisted to localStorage.
 * When the network request fails, the cached session is returned so route
 * guards don't redirect authenticated users to the login page.
 *
 * Detection relies on the `error` field returned by useSession() rather than
 * navigator.onLine — Chrome DevTools "Offline" doesn't reliably flip
 * navigator.onLine on a refresh, but the fetch still throws, so the error
 * signal is the source of truth. A definitive "online with no session"
 * (data null + error null + not pending) is the only state that triggers
 * a redirect.
 */
export function useAuthSession() {
  const { data: session, isPending, error } = authClient.useSession();
  const cached = useRef<CachedSession | null>(readCache());

  useEffect(() => {
    if (session) {
      const toCache: CachedSession = {
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image ?? null,
        },
      };
      cached.current = toCache;
      writeCache(toCache);
    }
  }, [session]);

  // While the request is in-flight, don't decide yet.
  if (isPending) {
    return { session: null, isPending: true, cachedSession: cached.current, isOfflineFallback: false };
  }

  // Session confirmed by server — use it.
  if (session) {
    return { session, isPending: false, cachedSession: cached.current, isOfflineFallback: false };
  }

  // Request errored or navigator reports offline → treat as offline and fall
  // back to the cached session if we have one. A 401/403 from the session
  // endpoint is treated like a real "no session" (skip the fallback) so a
  // user whose session was revoked server-side is still redirected to /.
  const status = (error as { status?: number } | null)?.status;
  const isAuthError = status === 401 || status === 403;
  const networkUnreachable = !!error && !isAuthError;
  if ((networkUnreachable || !navigator.onLine) && cached.current) {
    return {
      session: cached.current as unknown as typeof session,
      isPending: false,
      cachedSession: cached.current,
      isOfflineFallback: true,
    };
  }

  // Online with no session — genuinely unauthenticated.
  return { session: null, isPending: false, cachedSession: cached.current, isOfflineFallback: false };
}
