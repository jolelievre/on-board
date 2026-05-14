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
 * When the session fetch fails with a network error, the cached session is
 * returned so route guards don't redirect authenticated users to the login
 * page just because they're offline.
 *
 * We key the fallback on the fetch `error` (not on `navigator.onLine`) because
 * `navigator.onLine` is unreliable: Chrome DevTools "Offline" throttling,
 * captive portals, VPN drops, and flaky mobile connections can all leave
 * `onLine` true while requests fail. A clean server-side logout returns 200
 * with `data: null` and `error: null`, so it still drops to the login screen.
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

  if (isPending) {
    return { session: null, isPending: true, cachedSession: cached.current, isOfflineFallback: false };
  }

  if (session) {
    return { session, isPending: false, cachedSession: cached.current, isOfflineFallback: false };
  }

  if (error && cached.current) {
    return {
      session: cached.current as unknown as typeof session,
      isPending: false,
      cachedSession: cached.current,
      isOfflineFallback: true,
    };
  }

  return { session: null, isPending: false, cachedSession: cached.current, isOfflineFallback: false };
}
