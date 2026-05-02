import { useEffect, useState } from "react";
import { syncEngine } from "../lib/sync";

/**
 * Tracks navigator.onLine and flushes the sync queue when the app reconnects.
 *
 * Query refreshes on reconnect are handled by TanStack Query's built-in
 * refetchOnReconnect behaviour (default: true): stale queries refetch
 * automatically when the network returns, and if a refetch fails the old
 * cached data is preserved — so a 1-second blip can't wipe the offline cache.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      void syncEngine.flush();
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline };
}
