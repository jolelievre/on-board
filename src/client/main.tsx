import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import {
  QueryClientProvider,
  hydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  persistQueryClientSubscribe,
  type PersistedClient,
} from "@tanstack/react-query-persist-client";
import { queryClient, NINETY_DAYS } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";
import { ThemeProvider } from "./contexts/ThemeContext";
import { registerSW } from "virtual:pwa-register";
import "./lib/i18n";

const PERSIST_KEY = "onboard_query_cache";

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: PERSIST_KEY,
  // Default is 1000ms — would batch writes and let `page.reload()` (or any
  // post-mutation reload) race the throttle window. We want every cache event
  // flushed to localStorage before control returns, so offline reads always
  // see the latest state.
  throttleTime: 0,
});

// Hydrate synchronously before createRoot().render() so every useQuery
// subscriber sees cached data on the first render. PersistQueryClientProvider
// would restore via useEffect (one async tick later), leaving a window where
// queries fire against an empty cache and — offline — get stuck pending+paused.
//
// `restoreClient` is typed as `PersistedClient | Promise<...>` to support
// async storage; for the sync localStorage persister it returns synchronously,
// so the cast is safe.
const stored = persister.restoreClient() as PersistedClient | undefined;
if (stored) {
  const expired = Date.now() - (stored.timestamp ?? 0) > NINETY_DAYS;
  if (expired || stored.buster !== "") {
    void persister.removeClient();
  } else {
    hydrate(queryClient, stored.clientState as DehydratedState);
  }
}

// Subscribe for ongoing writes. Library default `shouldDehydrateQuery`
// (status === "success") is sufficient — our offline path can't reach
// status "error" with cached data: networkMode "offlineFirst" + retry pause
// keeps refetch failures in `success` + `fetchStatus: paused`, not `error`.
persistQueryClientSubscribe({ queryClient, persister });

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
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
