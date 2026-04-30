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
import { usePrefetchGames } from "../hooks/usePrefetchGames";
import { BottomNav } from "../components/layout/BottomNav";
import { OfflineBanner } from "../components/layout/OfflineBanner";

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
      {!isOnline && <OfflineBanner />}
      <Outlet />
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
