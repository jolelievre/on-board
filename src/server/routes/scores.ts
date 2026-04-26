import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../middleware/auth.js";

type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

export const scoresRoutes = new Hono<AuthEnv>().patch(
  "/:id/scores",
  async (c) => {
    const user = c.get("user");
    const matchId = c.req.param("id");
    const body = await c.req.json();

    const { scores } = body as {
      scores?: {
        playerId: string;
        category: string;
        value: number;
        metadata?: Record<string, unknown>;
      }[];
    };

    if (!scores || !Array.isArray(scores) || scores.length === 0) {
      return c.json({ error: "scores array is required" }, 400);
    }

    // Validate match exists and belongs to user
    const match = await prisma.match.findFirst({
      where: { id: matchId, createdById: user.id },
      include: { players: true },
    });

    if (!match) {
      return c.json({ error: "Match not found" }, 404);
    }

    const playerIds = new Set(match.players.map((p) => p.id));

    // Validate each score entry
    for (const score of scores) {
      if (!score.playerId || !score.category) {
        return c.json(
          { error: "Each score must have playerId and category" },
          400,
        );
      }
      if (typeof score.value !== "number" || !Number.isInteger(score.value)) {
        return c.json({ error: "Score value must be an integer" }, 400);
      }
      if (!playerIds.has(score.playerId)) {
        return c.json(
          { error: `Player ${score.playerId} is not in this match` },
          400,
        );
      }
    }

    // Upsert scores using the unique constraint [matchId, playerId, category]
    const results = await prisma.$transaction(
      scores.map((score) =>
        prisma.score.upsert({
          where: {
            matchId_playerId_category: {
              matchId,
              playerId: score.playerId,
              category: score.category,
            },
          },
          update: {
            value: score.value,
            metadata: (score.metadata ?? {}) as Prisma.InputJsonValue,
          },
          create: {
            matchId,
            playerId: score.playerId,
            category: score.category,
            value: score.value,
            metadata: (score.metadata ?? {}) as Prisma.InputJsonValue,
          },
        }),
      ),
    );

    return c.json(results);
  },
);
