import { Hono } from "hono";
import { logger } from "hono/logger";
import { auth } from "./lib/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { gamesRoutes } from "./routes/games.js";
import { matchesRoutes } from "./routes/matches.js";
import { scoresRoutes } from "./routes/scores.js";
import { profilesRoutes } from "./routes/profiles.js";
import { uploadsRoutes } from "./routes/uploads.js";

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

app.use("/profiles/*", requireAuth);
app.route("/profiles", profilesRoutes);

// Public static-serve for owner-uploaded avatars. No auth — the URL
// embeds the profile id + a per-upload random version token so leaking
// the URL is the only way someone else can fetch the file (same
// capability model as Google avatar URLs).
app.route("/uploads", uploadsRoutes);

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
