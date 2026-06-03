import { Hono } from "hono";
import { logger } from "hono/logger";
import { auth, getEnabledSocialProviders } from "./lib/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { gamesRoutes } from "./routes/games.js";
import { matchesRoutes } from "./routes/matches.js";
import { scoresRoutes } from "./routes/scores.js";
import { profilesRoutes } from "./routes/profiles.js";
import { uploadsRoutes } from "./routes/uploads.js";
import { shareRoutes } from "./routes/share.js";

const app = new Hono().basePath("/api");

app.use("*", logger());

// Public — which OAuth providers actually have credentials configured.
// The login page reads this to render only the buttons the server can
// authenticate against. Mounted BEFORE the better-auth wildcard so it
// short-circuits the catch-all.
app.get("/auth/providers", (c) => {
  return c.json({ providers: getEnabledSocialProviders() });
});

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

// Public read-only match share — no auth, capability-on-URL model.
// The token sits in the URL; revoking the token invalidates the link.
app.route("/share", shareRoutes);

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
