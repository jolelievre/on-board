import { useEffect } from "react";
import { useAuthSession } from "./useAuthSession";
import { pullSync } from "../lib/pull-sync";
import { syncEngine } from "../lib/sync";

/**
 * Once per authenticated mount, pull the latest server state into
 * Dexie. Reads are reactive via `useLiveQuery`, so the UI updates as
 * soon as the merge commits.
 *
 * Replaces the old `usePrefetchGames` which prefetched every game and
 * match list into TanStack Query — that work is now subsumed by
 * pullSync (one round-trip for `/api/games`, one for `/api/matches`).
 *
 * Also kicks `syncEngine.flush()` on boot. The flush event chain is
 * normally driven by `online` browser events, but those don't fire
 * after a refresh-while-offline where `navigator.onLine` stays true
 * (DevTools throttling, captive portal). Without this, queued writes
 * from the previous session would sit stuck until the user happens to
 * make a new mutation.
 */
export function usePullOnAuth() {
  const { session, isPending } = useAuthSession();

  useEffect(() => {
    if (isPending || !session) return;
    // Initial pull is forced — we want a fresh catalog + match list on
    // first authenticated mount even if a throttled pull happened
    // moments earlier in the same JS session (e.g. an earlier
    // unauthenticated probe).
    void pullSync({ force: true }).catch(() => {
      // Offline or transient failure — UI keeps showing cached Dexie
      // data and the next online tick or flush will retry the pull.
    });
    // Independent of pullSync success: drain any leftover queue from
    // a prior session. flush() short-circuits if navigator.onLine is
    // false, so this is safe when actually offline.
    void syncEngine.flush().catch(() => {
      /* surfaced via syncQueue retries */
    });
  }, [session, isPending]);
}
