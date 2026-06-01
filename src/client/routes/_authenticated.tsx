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
import { pullSync, resetCursorsIfViewerChanged } from "../lib/pull-sync";
import { syncEngine } from "../lib/sync";
import { BottomNav } from "../components/layout/BottomNav";
import { OfflineBanner } from "../components/layout/OfflineBanner";
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
      // Drop the per-device `?since=` cursors when a different viewer
      // signs in here. Without this the next pullSync would filter
      // out any of the new viewer's rows that pre-date the prior
      // viewer's last pull — most visibly their self-Profile, which
      // is created once at signup and is then never updated again.
      await resetCursorsIfViewerChanged(session.user.id);
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
      <SyncStatus />
      <Outlet />
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
