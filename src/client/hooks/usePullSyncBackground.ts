import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { pullSync } from "../lib/pull-sync";

/**
 * Background pullSync triggers — the "passive freshness" layer that
 * sits alongside `usePullOnAuth` (boot) and `syncEngine.flush()`
 * (post-mutation).
 *
 * Two triggers:
 *
 * 1. **`visibilitychange` → forced pull.** When the tab regains focus
 *    (user switches back from another tab or from another device's
 *    browser window), force-pull so any changes made elsewhere become
 *    visible without a manual refresh. This is the standard "refetch
 *    on focus" pattern; without it, cross-device writes only surface
 *    when the laptop user happens to mutate something or refresh the
 *    page.
 *
 * 2. **Route change → throttled pull.** Every in-app navigation
 *    opportunistically pulls. The throttle inside `pullSync` (5 s
 *    minimum interval) dedupes rapid clicks, so a user navigating
 *    /games → /games/7-wonders-duel → back doesn't fire three pulls.
 *    Most navigations after an active in-tab session no-op via the
 *    throttle; the first navigation after a quiet period actually
 *    pulls.
 *
 * Mounted once in `_authenticated.tsx`. Unmounting tears down both
 * subscriptions cleanly.
 */
export function usePullSyncBackground(): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    function handleVisibility(): void {
      if (document.visibilityState === "visible") {
        void pullSync({ force: true }).catch(() => {
          // Transient failure — next trigger retries.
        });
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    void pullSync().catch(() => {
      /* throttle short-circuit or transient failure */
    });
  }, [pathname]);
}
