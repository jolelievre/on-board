import { useEffect } from "react";
import { useAuthSession } from "./useAuthSession";
import { pullSync } from "../lib/pull-sync";

/**
 * Once per authenticated mount, pull the latest server state into
 * Dexie. Reads are reactive via `useLiveQuery`, so the UI updates as
 * soon as the merge commits.
 *
 * Replaces the old `usePrefetchGames` which prefetched every game and
 * match list into TanStack Query — that work is now subsumed by
 * pullSync (one round-trip for `/api/games`, one for `/api/matches`).
 */
export function usePullOnAuth() {
  const { session, isPending } = useAuthSession();

  useEffect(() => {
    if (isPending || !session) return;
    void pullSync().catch(() => {
      // Offline or transient failure — UI keeps showing cached Dexie
      // data and the next online tick or flush will retry the pull.
    });
  }, [session, isPending]);
}
