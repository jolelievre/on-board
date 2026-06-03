import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { structuredError } from "../lib/structured-errors.js";
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
      return structuredError(c, 400, {
        error: "scores array is required",
        field: "scores",
      });
    }

    // Validate match exists and belongs to user
    const match = await prisma.match.findFirst({
      where: { id: matchId, createdById: user.id },
      include: { players: true },
    });

    if (!match) {
      return structuredError(c, 404, {
        error: "Match not found",
        hint: "The match was not synced or was deleted from the server.",
      });
    }

    const playerIds = new Set(match.players.map((p) => p.id));

    // Validate each score entry
    for (const score of scores) {
      if (!score.playerId || !score.category) {
        return structuredError(c, 400, {
          error: "Each score must have playerId and category",
          field: "scores",
        });
      }
      if (typeof score.value !== "number" || !Number.isInteger(score.value)) {
        return structuredError(c, 400, {
          error: "Score value must be an integer",
          field: "scores",
        });
      }
      if (!playerIds.has(score.playerId)) {
        return structuredError(c, 400, {
          error: `Player ${score.playerId} is not in this match`,
          field: "scores",
          hint: "The match's player list on the server does not include this id — the create-match POST may still be queued or failed.",
        });
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
