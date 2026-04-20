import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();

app.use("*", logger());

// API routes
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve SPA static files in production
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist/client" }));

  // SPA fallback: serve index.html for all non-API routes
  app.get("*", serveStatic({ root: "./dist/client", path: "index.html" }));
}

const port = Number(process.env.PORT) || 3000;

console.log(`Server running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });

export default app;
