import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono().basePath("/api");

app.use("*", logger());

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
