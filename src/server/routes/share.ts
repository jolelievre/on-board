import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";

/**
 * Public read-only share endpoint (PR 8-D).
 *
 * `GET /api/share/:token` — no auth required. Returns a minimal
 * summary payload for a completed match: game name + slug, completion
 * timestamp, per-player alias + final score, winner alias, victory
 * type. Deliberately excludes profile ids, owner identity, and any
 * field that could be used to reach back into the owner's data.
 *
 * Owner-only mint / revoke endpoints live on the protected `/matches`
 * route (see `src/server/routes/matches.ts`).
 */
export const shareRoutes = new Hono().get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!token) {
    return c.json({ error: "Token required" }, 400);
  }

  const row = await prisma.matchShareToken.findUnique({
    where: { id: token },
    include: {
      match: {
        include: {
          game: { select: { name: true, slug: true } },
          players: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              position: true,
              profile: { select: { alias: true } },
            },
          },
          scores: { select: { playerId: true, value: true } },
        },
      },
    },
  });
  if (!row || row.match.status !== "COMPLETED") {
    return c.json({ error: "Share link not found" }, 404);
  }

  const totalByPlayer = new Map<string, number>();
  for (const s of row.match.scores) {
    totalByPlayer.set(
      s.playerId,
      (totalByPlayer.get(s.playerId) ?? 0) + s.value,
    );
  }

  const players = row.match.players.map((p) => ({
    alias: p.profile.alias,
    score: totalByPlayer.get(p.id) ?? 0,
    isWinner: p.id === row.match.winnerId,
  }));

  return c.json({
    game: { name: row.match.game.name, slug: row.match.game.slug },
    completedAt: row.match.completedAt?.toISOString() ?? null,
    victoryType: row.match.victoryType,
    players,
  });
});
