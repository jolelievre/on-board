import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./lib/i18n";

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

// Service-worker registration is performed by `useRegisterSW` inside the
// UpdateBanner component (mounted from __root.tsx). With registerType:
// "prompt" the user explicitly accepts the update, so the new precache is
// guaranteed to be ready before the page reloads — no stale-precache
// window when going offline immediately after a new deploy.

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
