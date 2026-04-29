import { defineConfig, type Plugin } from "vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import type { IncomingHttpHeaders } from "http";
import path from "path";

function toHeadersInit(raw: IncomingHttpHeaders): HeadersInit {
  const headers: [string, string][] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.push([key, v]);
    } else {
      headers.push([key, value]);
    }
  }
  return headers;
}

function honoDevServer(): Plugin {
  return {
    name: "hono-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();

        try {
          // Dynamic import to pick up changes on reload
          const { default: app } = await server.ssrLoadModule(
            "./src/server/app.ts",
          );

          const hasBody = req.method !== "GET" && req.method !== "HEAD";
          const request = new Request(
            new URL(req.url, `http://${req.headers.host}`),
            {
              method: req.method,
              headers: toHeadersInit(req.headers),
              ...(hasBody
                ? { body: req as unknown as ReadableStream, duplex: "half" }
                : {}),
            },
          );

          const response = await app.fetch(request);

          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => {
            if (key.toLowerCase() !== "set-cookie") {
              res.setHeader(key, value);
            }
          });
          // Handle Set-Cookie separately — Headers.forEach merges them
          // into a single comma-separated string which breaks cookie parsing
          const setCookies = response.headers.getSetCookie();
          if (setCookies.length > 0) {
            res.setHeader("set-cookie", setCookies);
          }
          const body = await response.text();
          res.end(body);
        } catch (err) {
          console.error("[hono-dev-server]", err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      target: "react",
      routesDirectory: "./src/client/routes",
      generatedRouteTree: "./src/client/routeTree.gen.ts",
      quoteStyle: "double",
      semicolons: true,
    }),
    react(),
    honoDevServer(),
    VitePWA({
      registerType: "autoUpdate",
      // Don't activate the SW in dev — keeps Vite HMR clean.
      devOptions: { enabled: false },
      workbox: {
        // Precache everything Vite emits, including bundled font files.
        globPatterns: ["**/*.{js,css,html,woff,woff2,svg,png,ico}"],
        // The SPA shell handles routing — fall back to index.html for
        // navigations so the app still loads when offline.
        navigateFallback: "/index.html",
        // Don't intercept API calls — let them fail naturally when offline.
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: "OnBoard",
        short_name: "OnBoard",
        description: "Board game score tracker",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f4ecdc",
        theme_color: "#9f2d1a",
        icons: [
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  ssr: {
    // Externalize server-only packages so Vite's SSR loader
    // doesn't try to evaluate CJS modules as ESM
    external: ["@prisma/client", "better-auth", "pg"],
  },
  build: {
    outDir: "dist/client",
  },
});
