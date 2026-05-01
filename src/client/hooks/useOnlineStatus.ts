import { useEffect, useState } from "react";
import { onlineManager } from "@tanstack/react-query";
import { syncEngine } from "../lib/sync";

/**
 * Tracks online/offline state and flushes the sync queue when the app
 * reconnects.
 *
 * Uses TanStack Query's `onlineManager` as the source of truth instead of
 * raw window 'online'/'offline' events. The manager already wires those
 * events for us, AND `src/client/lib/api.ts` calls `setOnline(false)`
 * whenever a fetch throws — so a Chrome DevTools "Offline" throttle (which
 * is unreliable about firing the window events on a hard refresh) still
 * flips the app into offline mode the moment a request fails.
 *
 * Query refreshes on reconnect are handled by TanStack Query's built-in
 * refetchOnReconnect behaviour (default: true): stale queries refetch
 * automatically when the network returns, and if a refetch fails the old
 * cached data is preserved — so a 1-second blip can't wipe the offline cache.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(onlineManager.isOnline());

  useEffect(() => {
    return onlineManager.subscribe((online) => {
      setIsOnline(online);
      if (online) {
        // Push any queued offline mutations to the server. The sync engine
        // calls queryClient.invalidateQueries() only after confirmed
        // successes, so the cache is never discarded unless the server
        // actually accepted the writes.
        void syncEngine.flush();
      }
    });
  }, []);

  return { isOnline };
}
