import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import api from "./app.js";

const app = new Hono();

// Mount API routes
app.route("/", api);

// Serve SPA static files in production
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ root: "./dist/client", path: "index.html" }));

const port = Number(process.env.PORT) || 3000;

console.log(`Server running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
