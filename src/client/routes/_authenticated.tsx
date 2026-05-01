import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthSession } from "../hooks/useAuthSession";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { usePrefetchGames } from "../hooks/usePrefetchGames";
import { BottomNav } from "../components/layout/BottomNav";
import { OfflineBanner } from "../components/layout/OfflineBanner";
import { SyncPill } from "../components/ui/SyncPill";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

/** Shows the full offline banner for 5 s, then collapses to a compact pill.
 * Resets to the full banner each time the connection drops again. */
function NetworkStatusBar({ isOnline }: { isOnline: boolean }) {
  const [showBanner, setShowBanner] = useState(true);

  useEffect(() => {
    if (isOnline) {
      setShowBanner(true);
      return;
    }
    setShowBanner(true);
    const timer = setTimeout(() => setShowBanner(false), 5000);
    return () => clearTimeout(timer);
  }, [isOnline]);

  if (isOnline) return null;
  if (showBanner) return <OfflineBanner />;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        padding: "2px 12px",
      }}
    >
      <SyncPill state="offline" />
    </div>
  );
}

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
  usePrefetchGames();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hideBottomNav = shouldHideBottomNav(pathname);

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
      <NetworkStatusBar isOnline={isOnline} />
      <Outlet />
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
