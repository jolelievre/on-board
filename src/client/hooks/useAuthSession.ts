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
 * When the network request fails (navigator.onLine is false), the cached
 * session is returned so route guards don't redirect authenticated users
 * to the login page just because they're offline.
 *
 * Only a definitive online failure (session = null while online + not pending)
 * triggers a redirect.
 */
export function useAuthSession() {
  const { data: session, isPending } = authClient.useSession();
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

  if (!navigator.onLine && cached.current) {
    return {
      session: cached.current as unknown as typeof session,
      isPending: false,
      cachedSession: cached.current,
      isOfflineFallback: true,
    };
  }

  return { session: null, isPending: false, cachedSession: cached.current, isOfflineFallback: false };
}
