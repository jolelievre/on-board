import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthSession } from "../hooks/useAuthSession";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { usePullSyncBackground } from "../hooks/usePullSyncBackground";
import { pullSync, resetPullCursors } from "../lib/pull-sync";
import { syncEngine } from "../lib/sync";
import { BottomNav } from "../components/layout/BottomNav";
import { OfflineBanner } from "../components/layout/OfflineBanner";
import { SyncFailedBanner } from "../components/layout/SyncFailedBanner";
import { SyncStatus } from "../components/sync/SyncStatus";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

/** Routes where the global bottom nav should hide so the screen has full
 * vertical real estate. Keeping this in the layout (not in each route) so
 * the policy is centralized. */
function shouldHideBottomNav(pathname: string): boolean {
  return /^\/matches\/[^/]+$/.test(pathname);
}

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { session, isPending } = useAuthSession();
  const { isOnline } = useOnlineStatus();
  usePullSyncBackground();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hideBottomNav = shouldHideBottomNav(pathname);

  // Boot-time pull + queue flush, once per authenticated mount.
  // - Initial pull is forced so a fresh catalogue + match list lands even
  //   if a throttled pull happened moments earlier in the same JS session.
  // - flush() drains any queue left over from a prior session: the normal
  //   trigger is the `online` event, which doesn't fire after a
  //   refresh-while-offline where `navigator.onLine` stays true (DevTools
  //   throttling, captive portal). flush() short-circuits when offline.
  useEffect(() => {
    if (isPending || !session) return;
    void (async () => {
      // Drop the per-device `?since=` cursors on every authenticated
      // mount so the boot pullSync re-fetches the viewer's full
      // visible set. Without this, incremental pulls would silently
      // omit any row whose `updatedAt` predates whatever cursor the
      // device happens to hold — bites hardest when the cursor was
      // written during a previous user's session on a shared device
      // (the new viewer's self-Profile and old friend rows never
      // arrive), but the failure mode also includes a same-user
      // session whose Dexie cache lost an entry to browser storage
      // eviction. For OnBoard's friend-circle data volume the cost
      // of a full pull per page reload is negligible; incremental
      // pulls still cover the in-session triggers (visibility,
      // online, post-flush) for efficiency.
      await resetPullCursors();
      await pullSync({ force: true }).catch(() => {
        /* offline or transient — next online tick / flush retries */
      });
      await syncEngine.flush().catch(() => {
        /* surfaced via syncQueue retries */
      });
    })();
  }, [session, isPending]);

  useEffect(() => {
    if (!isPending && !session) {
      navigate({ to: "/" });
    }
  }, [session, isPending, navigate]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p style={{ color: "var(--color-ink-faint)" }}>{t("common.loading")}</p>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div
      className={`flex min-h-screen flex-col ${hideBottomNav ? "" : "pb-24"}`}
    >
      {!isOnline && <OfflineBanner />}
      <SyncFailedBanner />
      <SyncStatus />
      <Outlet />
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
