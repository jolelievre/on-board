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

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "onboard_query_cache",
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
