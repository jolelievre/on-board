import { defineConfig, type Plugin } from "vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
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
