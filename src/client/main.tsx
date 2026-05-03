import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import {
  QueryClientProvider,
  hydrate,
  type DehydratedState,
} from "@tanstack/react-query";
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

// Synchronous persister — localStorage.setItem runs in the same microtask
// as the cache event, before any async defer. PersistQueryClientProvider
// restores via useEffect (one async tick after first render), which leaves
// a window where queries fire against an empty cache. Synchronous hydration
// below closes that race.
const persister = {
  persistClient(client: PersistedClient): void {
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(client));
    } catch {
      // localStorage quota exceeded — degrade gracefully
    }
  },
  restoreClient(): PersistedClient | undefined {
    try {
      const raw = window.localStorage.getItem(PERSIST_KEY);
      return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
    } catch {
      return undefined;
    }
  },
  removeClient(): void {
    window.localStorage.removeItem(PERSIST_KEY);
  },
};

// Hydrate the QueryClient synchronously — before createRoot().render() runs.
// This means every useQuery subscriber finds cached data on the very first
// render, so no query fires an empty-cache fetch that could fail offline and
// get stuck in pending+paused.
const stored = persister.restoreClient();
if (stored) {
  const expired = Date.now() - (stored.timestamp ?? 0) > NINETY_DAYS;
  if (expired || stored.buster !== "") {
    persister.removeClient();
  } else {
    hydrate(queryClient, stored.clientState as DehydratedState);
  }
}

// Subscribe for ongoing writes. Every cache "added"/"removed"/"updated"
// event writes the full dehydrated state to localStorage synchronously.
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
