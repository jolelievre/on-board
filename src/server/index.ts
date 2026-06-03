import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import api from "./app.js";
import { ensureAvatarsDir } from "./lib/avatar-storage.js";
import { buildShareOgPayload, injectShareOg } from "./lib/share-og.js";

const app = new Hono();

// Mount API routes
app.route("/", api);

// Public match share page — SSR-inject Open Graph meta tags so chat
// apps unfurl with the matchup summary. The SPA still hydrates from
// `/api/share/:token` as before; OG tags are purely for crawlers.
// See `src/server/lib/share-og.ts` for the rationale.
const SPA_SHELL_PATH = "./dist/client/index.html";
let spaShellCache: string | null = null;
async function readSpaShell(): Promise<string> {
  if (spaShellCache === null) {
    spaShellCache = await readFile(SPA_SHELL_PATH, "utf-8");
  }
  return spaShellCache;
}
app.get("/share/:token", async (c) => {
  const token = c.req.param("token");
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const [html, payload] = await Promise.all([
    readSpaShell(),
    buildShareOgPayload(token),
  ]);
  const injected = injectShareOg(
    html,
    payload,
    `${baseUrl}/share/${token}`,
    `${baseUrl}/pwa-icon-512.png`,
  );
  return c.html(injected);
});

// Serve SPA static files in production
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ root: "./dist/client", path: "index.html" }));

const port = Number(process.env.PORT) || 3000;

// Make sure the uploads dir is in place before the first POST hits it.
// Logged-not-thrown so a startup glitch (e.g. read-only FS during a
// canary deploy) doesn't crash the process — the upload endpoint will
// fail with a 5xx and surface the real cause.
ensureAvatarsDir().catch((err) => {
  console.error("[boot] could not ensure /uploads/avatars exists", err);
});

console.log(`Server running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
