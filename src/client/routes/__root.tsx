import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { UpdateBanner } from "../components/layout/UpdateBanner";

// Skip devtools under `VITE_TEST_AUTH` so the floating devtools button
// doesn't overlay the BottomNav and intercept clicks during E2E tests
// (observed on Linux webkit on CI — iPhone 13 viewport overlap).
const TanStackRouterDevtools =
  import.meta.env.DEV && !import.meta.env.VITE_TEST_AUTH
    ? lazy(() =>
        import("@tanstack/router-devtools").then((mod) => ({
          default: mod.TanStackRouterDevtools,
        })),
      )
    : () => null;

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <UpdateBanner />
      <Outlet />
      <Suspense>
        <TanStackRouterDevtools />
      </Suspense>
    </>
  );
}
