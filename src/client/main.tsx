import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import {
  PersistQueryClientProvider,
  type Persister,
  type PersistedClient,
} from "@tanstack/react-query-persist-client";
import { queryClient, NINETY_DAYS } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";
import { ThemeProvider } from "./contexts/ThemeContext";
import { registerSW } from "virtual:pwa-register";
import "./lib/i18n";

const PERSIST_KEY = "onboard_query_cache";

// Custom persister that writes synchronously to localStorage on every cache
// change. createSyncStoragePersister throttles writes via setTimeout even
// when throttleTime is 0, which means the write is deferred to the next
// macrotask. In a service-worker environment a navigation can reload the JS
// context before that task fires, silently dropping the write. Writing
// synchronously (inside the async subscribe callback, before any await)
// guarantees the data lands in localStorage in the same tick as the cache
// event.
const persister: Persister = {
  persistClient(client: PersistedClient): void {
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(client));
    } catch {
      // localStorage full — non-fatal, app degrades gracefully offline
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
      persistOptions={{
        persister,
        maxAge: NINETY_DAYS,
        // Also persist errored queries that still carry their last-known data,
        // so a failed background refetch while offline doesn't evict good cache.
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" ||
            (query.state.status === "error" && query.state.data !== undefined),
        },
      }}
    >
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
