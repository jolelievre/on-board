import { Hono } from "hono";
import { logger } from "hono/logger";
import { auth } from "./lib/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { gamesRoutes } from "./routes/games.js";
import { matchesRoutes } from "./routes/matches.js";
import { scoresRoutes } from "./routes/scores.js";
import { playersRoutes } from "./routes/players.js";

const app = new Hono().basePath("/api");

app.use("*", logger());

// better-auth handler: delegates all /api/auth/* to better-auth
app.all("/auth/*", (c) => auth.handler(c.req.raw));

// Public routes
app.route("/games", gamesRoutes);

// Protected routes
app.use("/matches/*", requireAuth);
app.route("/matches", matchesRoutes);
app.route("/matches", scoresRoutes);

app.use("/players/*", requireAuth);
app.route("/players", playersRoutes);

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
