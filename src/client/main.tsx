import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import {
  QueryClientProvider,
  hydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { persistQueryClientSubscribe } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { queryClient, NINETY_DAYS } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";
import { ThemeProvider } from "./contexts/ThemeContext";
import { registerSW } from "virtual:pwa-register";
import "./lib/i18n";

const PERSIST_KEY = "onboard_query_cache";

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: PERSIST_KEY,
  // Default throttle is 1s, which can swallow prefetched data when the
  // user goes offline within ~1s of a successful fetch (typical on a
  // preview environment where the click-through is faster than on local
  // dev). Write immediately so prefetched data is durable.
  throttleTime: 0,
});

// SYNCHRONOUS hydration before React renders.
//
// PersistQueryClientProvider hydrates inside a useEffect (i.e. after the
// first render), which means a route loader or a component's first
// `useQuery` observe an empty cache on hard refresh — even though
// localStorage has the data. With `networkMode: 'offlineFirst'` the empty
// observer then fires its queryFn, which fails offline, and the page
// sits on a permanent "Chargement…" because the cache is hydrated only
// AFTER that initial render. Reading localStorage and calling `hydrate`
// here fixes the race: by the time React mounts anything, every
// persisted query is already in the QueryClient.
try {
  const raw = window.localStorage.getItem(PERSIST_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as {
      timestamp?: number;
      clientState?: DehydratedState;
    };
    const fresh =
      typeof parsed.timestamp === "number" &&
      Date.now() - parsed.timestamp <= NINETY_DAYS;
    if (fresh && parsed.clientState) {
      hydrate(queryClient, parsed.clientState);
    } else if (!fresh) {
      window.localStorage.removeItem(PERSIST_KEY);
    }
  }
} catch {
  // Corrupt snapshot — clear it and start fresh. Better to lose offline
  // data than to crash the app.
  window.localStorage.removeItem(PERSIST_KEY);
}

// Subscribe for ongoing persistence (writes only — restore was handled
// synchronously above).
//
// shouldDehydrateQuery also includes errored queries that still carry their
// last-known data. Without this, a background refetch that fails while
// offline (status transitions from 'success' → 'error') would cause the
// persister to write a dehydrated snapshot that excludes those queries,
// silently evicting valid cache data from localStorage even though the
// in-memory cache still holds it.
persistQueryClientSubscribe({
  queryClient,
  persister,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" ||
      (query.state.status === "error" && query.state.data !== undefined),
  },
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
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
