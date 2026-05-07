import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
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

    const { gameId, players, metadata } = body as {
      gameId?: string;
      players?: { name: string; userId?: string; position: number }[];
      metadata?: Record<string, unknown>;
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

    // userId attribution is opt-in by the client and only allowed for the
    // currently authenticated user. Name-based auto-linking would mis-attach
    // a friend who happens to share the user's name.
    for (const p of players) {
      if (p.userId && p.userId !== user.id) {
        return c.json(
          { error: "Players can only be linked to your own user account" },
          403,
        );
      }
    }

    const match = await prisma.match.create({
      data: {
        gameId,
        createdById: user.id,
        ...(metadata
          ? { metadata: metadata as Prisma.InputJsonValue }
          : {}),
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
        // id needed so the client can hydrate `["matches", id]` cache keys
        // from the list response without an extra detail fetch.
        game: { select: { id: true, name: true, slug: true } },
        players: {
          orderBy: { position: "asc" },
          include: {
            user: { select: { name: true, alias: true } },
          },
        },
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
        players: {
          orderBy: { position: "asc" },
          include: {
            user: { select: { name: true, alias: true } },
          },
        },
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
  })
  .patch("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = await c.req.json();

    const { metadata, playerOrder } = body as {
      metadata?: Record<string, unknown>;
      playerOrder?: { playerId: string; position: number }[];
    };

    const existing = await prisma.match.findFirst({
      where: { id, createdById: user.id },
      include: { players: true },
    });

    if (!existing) {
      return c.json({ error: "Match not found" }, 404);
    }

    if (existing.status === "COMPLETED") {
      return c.json(
        { error: "Cannot edit a completed match" },
        400,
      );
    }

    if (playerOrder) {
      if (!Array.isArray(playerOrder) || playerOrder.length === 0) {
        return c.json({ error: "playerOrder must be a non-empty array" }, 400);
      }
      const existingIds = new Set(existing.players.map((p) => p.id));
      const seenIds = new Set<string>();
      const seenPositions = new Set<number>();
      for (const entry of playerOrder) {
        if (!entry || typeof entry.playerId !== "string") {
          return c.json({ error: "Each playerOrder entry must have playerId" }, 400);
        }
        if (typeof entry.position !== "number" || !Number.isInteger(entry.position)) {
          return c.json({ error: "playerOrder positions must be integers" }, 400);
        }
        if (!existingIds.has(entry.playerId)) {
          return c.json(
            { error: `Player ${entry.playerId} is not in this match` },
            400,
          );
        }
        if (seenIds.has(entry.playerId)) {
          return c.json({ error: "Duplicate playerId in playerOrder" }, 400);
        }
        if (seenPositions.has(entry.position)) {
          return c.json({ error: "Duplicate position in playerOrder" }, 400);
        }
        seenIds.add(entry.playerId);
        seenPositions.add(entry.position);
      }
      // Reorder must cover every player so the unique [matchId, position]
      // constraint can't be violated by leaving stale rows.
      if (seenIds.size !== existing.players.length) {
        return c.json(
          { error: "playerOrder must include every player in the match" },
          400,
        );
      }
    }

    // Two-phase position swap to dodge the unique [matchId, position]
    // constraint: park rows at temporary negative positions, then write the
    // final values. Wrapped in a transaction with the metadata update so a
    // partial failure can't leave orphans.
    const result = await prisma.$transaction(async (tx) => {
      if (playerOrder) {
        for (const entry of playerOrder) {
          await tx.player.update({
            where: { id: entry.playerId },
            data: { position: -1 - entry.position },
          });
        }
        for (const entry of playerOrder) {
          await tx.player.update({
            where: { id: entry.playerId },
            data: { position: entry.position },
          });
        }
      }
      return tx.match.update({
        where: { id },
        data: {
          ...(metadata !== undefined
            ? { metadata: metadata as Prisma.InputJsonValue }
            : {}),
        },
        include: {
          players: { orderBy: { position: "asc" } },
          scores: true,
        },
      });
    });

    return c.json(result);
  });
