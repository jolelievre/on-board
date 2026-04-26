import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../middleware/auth.js";

type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

export const matchesRoutes = new Hono<AuthEnv>()
  .post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();

    const { gameId, players } = body as {
      gameId?: string;
      players?: { name: string; userId?: string; position: number }[];
    };

    if (!gameId || !players || !Array.isArray(players) || players.length === 0) {
      return c.json({ error: "gameId and players array are required" }, 400);
    }

    // Validate game exists and player count
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }
    if (players.length < game.minPlayers || players.length > game.maxPlayers) {
      return c.json(
        {
          error: `This game requires ${game.minPlayers}–${game.maxPlayers} players`,
        },
        400,
      );
    }

    // Validate player names
    for (const p of players) {
      if (!p.name || typeof p.name !== "string" || p.name.trim().length === 0) {
        return c.json({ error: "All players must have a name" }, 400);
      }
      if (typeof p.position !== "number") {
        return c.json({ error: "All players must have a position" }, 400);
      }
    }

    const match = await prisma.match.create({
      data: {
        gameId,
        createdById: user.id,
        players: {
          create: players.map((p) => ({
            name: p.name.trim(),
            position: p.position,
            userId: p.userId || null,
          })),
        },
      },
      include: { players: true },
    });

    return c.json(match, 201);
  })
  .get("/", async (c) => {
    const user = c.get("user");
    const gameId = c.req.query("gameId");

    const matches = await prisma.match.findMany({
      where: {
        createdById: user.id,
        ...(gameId ? { gameId } : {}),
      },
      include: {
        game: { select: { name: true, slug: true } },
        players: { orderBy: { position: "asc" } },
        scores: true,
      },
      orderBy: { startedAt: "desc" },
    });

    return c.json(matches);
  })
  .get("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    const match = await prisma.match.findFirst({
      where: { id, createdById: user.id },
      include: {
        game: true,
        players: { orderBy: { position: "asc" } },
        scores: true,
      },
    });

    if (!match) {
      return c.json({ error: "Match not found" }, 404);
    }

    return c.json(match);
  })
  .put("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = await c.req.json();

    const { status, victoryType, winnerId } = body as {
      status?: string;
      victoryType?: string | null;
      winnerId?: string | null;
    };

    // Validate match exists and belongs to user
    const existing = await prisma.match.findFirst({
      where: { id, createdById: user.id },
      include: { players: true },
    });

    if (!existing) {
      return c.json({ error: "Match not found" }, 404);
    }

    // Validate status transition
    if (status && !["IN_PROGRESS", "COMPLETED"].includes(status)) {
      return c.json({ error: "Invalid status" }, 400);
    }

    // Validate winnerId belongs to match players
    if (winnerId) {
      const validPlayer = existing.players.some((p) => p.id === winnerId);
      if (!validPlayer) {
        return c.json({ error: "Winner must be a player in this match" }, 400);
      }
    }

    const match = await prisma.match.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(victoryType !== undefined ? { victoryType } : {}),
        ...(winnerId !== undefined ? { winnerId } : {}),
        ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
      },
      include: { players: true, scores: true },
    });

    return c.json(match);
  });
