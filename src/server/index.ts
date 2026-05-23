import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import api from "./app.js";
import { ensureAvatarsDir } from "./lib/avatar-storage.js";

const app = new Hono();

// Mount API routes
app.route("/", api);

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
