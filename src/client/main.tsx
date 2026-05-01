import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { queryClient, NINETY_DAYS } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";
import { ThemeProvider } from "./contexts/ThemeContext";
import { registerSW } from "virtual:pwa-register";
import "./lib/i18n";

// Bridge for Chrome DevTools "Offline" mode: that throttle reliably makes
// fetch reject but unreliably fires the window 'offline' event on a hard
// refresh. So wrap global fetch — on failure dispatch a synthetic
// 'offline' event, on success a synthetic 'online' event. We dispatch
// window events (rather than calling onlineManager.setOnline) so the
// manager stays in auto mode and real WiFi events keep flowing through
// the same channel — calling setOnline directly would put the manager
// into manual mode and stop honoring the OS network state.
const originalFetch = window.fetch.bind(window);
let lastDispatched: "online" | "offline" | null = null;
function dispatchOnline(state: "online" | "offline") {
  if (lastDispatched === state) return;
  lastDispatched = state;
  window.dispatchEvent(new Event(state));
}
window.fetch = async (...args) => {
  try {
    const res = await originalFetch(...args);
    dispatchOnline("online");
    return res;
  } catch (err) {
    dispatchOnline("offline");
    throw err;
  }
};

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "onboard_query_cache",
  // Default throttle is 1s, which can swallow prefetched data when the
  // user goes offline immediately after a fresh login. Write immediately
  // so prefetch results survive a refresh that happens within seconds.
  throttleTime: 0,
});

// Self-hosted fonts. Imported via JS so Vite bundles the woff2 assets
// into dist/ — CSS @import from @fontsource doesn't resolve the asset URLs.
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";
import "@fontsource/caveat/700.css";
import "@fontsource/patrick-hand/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import "./globals.css";

// Register the service worker so the app (and bundled fonts) work offline
// once the user has visited at least once. Auto-updates on new deploys.
registerSW({ immediate: true });

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: NINETY_DAYS }}
    >
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
