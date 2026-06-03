import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  ProfileAuthorizationError,
  resolvePlayerByProfileId,
} from "../lib/match-profiles.js";
import { matchVisibilityWhere } from "../lib/profile-scope.js";
import type { AuthUser } from "../middleware/auth.js";

type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

// Permissive shape check covering both CUID v1 (Prisma's default, `c` + 24 chars)
// and CUID v2 (variable length, alpha prefix). Rejects anything that isn't
// lowercase alphanumeric.
const CUID_RE = /^[a-z][a-z0-9]{19,31}$/;

// Player serialization projects the full Profile shape so clients can
// render any player regardless of whether they have visibility into the
// Profile row standalone. Without this, a friend-created match would
// arrive on the owner's side with Player rows pointing at Profiles the
// owner can't see (e.g. the friend's self-Profile), and the UI would
// have no name/avatar to render.
const playerProfileInclude = {
  profile: {
    select: {
      id: true,
      ownerId: true,
      linkedUserId: true,
      alias: true,
      customAvatarUrl: true,
      useLinkedAvatar: true,
      avatarFrame: true,
      avatarRing: true,
      linkedUser: {
        select: {
          id: true,
          name: true,
          alias: true,
          avatarUrl: true,
        },
      },
    },
  },
} as const satisfies Prisma.PlayerInclude;

const matchInclude = {
  game: true,
  players: {
    orderBy: { position: "asc" },
    include: playerProfileInclude,
  },
  scores: true,
} as const satisfies Prisma.MatchInclude;

export const matchesRoutes = new Hono<AuthEnv>()
  .post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();

    const {
      id: clientMatchId,
      gameId,
      players,
      metadata,
    } = body as {
      id?: string;
      gameId?: string;
      players?: {
        id?: string;
        profileId?: string;
        position: number;
      }[];
      metadata?: Record<string, unknown>;
    };

    if (!gameId || !players || !Array.isArray(players) || players.length === 0) {
      return c.json({ error: "gameId and players array are required" }, 400);
    }

    if (clientMatchId !== undefined && !CUID_RE.test(clientMatchId)) {
      return c.json({ error: "Invalid match id format" }, 400);
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

    // Every Player must reference an existing Profile. The legacy
    // name-only / userId attribution paths were removed in 6-C — clients
    // resolve each seat to a Profile via the picker/autocomplete before
    // submit. Reject any payload that still uses the old shape so the
    // failure mode is loud rather than producing rows we can't render.
    for (const p of players) {
      if (typeof p.profileId !== "string" || !CUID_RE.test(p.profileId)) {
        return c.json(
          { error: "Each player must include a valid profileId" },
          400,
        );
      }
      if (typeof p.position !== "number") {
        return c.json({ error: "All players must have a position" }, 400);
      }
      if (p.id !== undefined && !CUID_RE.test(p.id)) {
        return c.json({ error: "Invalid player id format" }, 400);
      }
    }

    // Idempotent create: a sync queue replaying after a partially-completed
    // POST must not produce a duplicate row. If the caller supplied an `id`
    // we already own, return the existing record (200); if another user owns
    // it, refuse (403). Otherwise fall through and create the match.
    if (clientMatchId) {
      const existing = await prisma.match.findUnique({
        where: { id: clientMatchId },
        include: matchInclude,
      });
      if (existing) {
        if (existing.createdById !== user.id) {
          return c.json({ error: "Match id is already in use" }, 403);
        }
        return c.json(existing, 200);
      }
    }

    // Resolve each player to a Profile owned by, or linked to, the
    // creator before inserting the Match so we can verify visibility
    // and bump `Profile.usedAt` in the same transaction.
    let match: Prisma.MatchGetPayload<{ include: typeof matchInclude }>;
    try {
      match = await prisma.$transaction(async (tx) => {
        const playersWithProfile = await Promise.all(
          players.map(async (p) => {
            const resolution = await resolvePlayerByProfileId(tx, {
              creatorId: user.id,
              profileId: p.profileId as string,
            });
            return {
              ...(p.id ? { id: p.id } : {}),
              position: p.position,
              profileId: resolution.profileId,
            };
          }),
        );

        return tx.match.create({
          data: {
            ...(clientMatchId ? { id: clientMatchId } : {}),
            gameId,
            createdById: user.id,
            ...(metadata
              ? { metadata: metadata as Prisma.InputJsonValue }
              : {}),
            players: {
              create: playersWithProfile,
            },
          },
          include: matchInclude,
        });
      });
    } catch (err) {
      if (err instanceof ProfileAuthorizationError) {
        return c.json({ error: err.message }, err.status);
      }
      // Idempotency race: when two replays of the same queued POST
      // arrive concurrently, both can pass the `findUnique` check above
      // before either commits, and the second `match.create` trips the
      // unique-id constraint. Treat that exactly like a successful
      // idempotent replay — re-fetch the row that the racing request
      // just wrote and return it as 200.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        clientMatchId
      ) {
        const winner = await prisma.match.findUnique({
          where: { id: clientMatchId },
          include: matchInclude,
        });
        if (winner && winner.createdById === user.id) {
          return c.json(winner, 200);
        }
      }
      throw err;
    }

    return c.json(match, 201);
  })
  .get("/", async (c) => {
    const user = c.get("user");
    const gameId = c.req.query("gameId");
    const since = c.req.query("since");

    // `since` powers pull-sync: clients pass their last-pull timestamp and
    // only get rows changed afterwards. Reject malformed values rather than
    // silently dropping the filter (which would re-pull everything).
    let sinceDate: Date | undefined;
    if (since !== undefined) {
      const parsed = new Date(since);
      if (Number.isNaN(parsed.getTime())) {
        return c.json({ error: "Invalid `since` timestamp" }, 400);
      }
      sinceDate = parsed;
    }

    const matches = await prisma.match.findMany({
      where: {
        AND: [
          matchVisibilityWhere(user.id),
          ...(gameId ? [{ gameId }] : []),
          ...(sinceDate ? [{ updatedAt: { gt: sinceDate } }] : []),
        ],
      },
      include: {
        game: { select: { id: true, name: true, slug: true } },
        players: {
          orderBy: { position: "asc" },
          include: playerProfileInclude,
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
      where: {
        AND: [{ id }, matchVisibilityWhere(user.id)],
      },
      include: {
        game: true,
        players: {
          orderBy: { position: "asc" },
          include: playerProfileInclude,
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
  })
  // ─── Share token (PR 8-D) ──────────────────────────────────────────
  //
  // Any participant in a completed match can mint, hydrate, or revoke
  // the public share link. The token is idempotent — re-POSTing returns
  // the existing one — and gated on `status === COMPLETED`. The first
  // user to mint owns the `createdById` audit field on the token row;
  // any later participant can still re-use or revoke it. Visibility
  // mirrors the rest of the `/matches` surface (PR 8-B
  // `matchVisibilityWhere`), so non-participants get 404 — same shape
  // as a viewer who can't see the match at all.
  .post("/:id/share-token", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    const match = await prisma.match.findFirst({
      where: { AND: [{ id }, matchVisibilityWhere(user.id)] },
      select: { id: true, status: true },
    });
    if (!match) {
      return c.json({ error: "Match not found" }, 404);
    }
    if (match.status !== "COMPLETED") {
      return c.json(
        { error: "Only completed matches can be shared" },
        400,
      );
    }

    const existing = await prisma.matchShareToken.findUnique({
      where: { matchId: id },
    });
    const token =
      existing ??
      (await prisma.matchShareToken.create({
        data: { matchId: id, createdById: user.id },
      }));

    return c.json(
      { token: token.id, createdAt: token.createdAt.toISOString() },
      existing ? 200 : 201,
    );
  })
  .delete("/:id/share-token", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    const match = await prisma.match.findFirst({
      where: { AND: [{ id }, matchVisibilityWhere(user.id)] },
      select: { id: true },
    });
    if (!match) {
      return c.json({ error: "Match not found" }, 404);
    }

    await prisma.matchShareToken.deleteMany({ where: { matchId: id } });
    return c.body(null, 204);
  })
  .get("/:id/share-token", async (c) => {
    // Hydrate the existing token (no auto-mint) so the dialog can
    // populate without bumping createdAt on every open.
    const user = c.get("user");
    const id = c.req.param("id");

    const match = await prisma.match.findFirst({
      where: { AND: [{ id }, matchVisibilityWhere(user.id)] },
      select: { id: true },
    });
    if (!match) {
      return c.json({ error: "Match not found" }, 404);
    }

    const token = await prisma.matchShareToken.findUnique({
      where: { matchId: id },
    });
    if (!token) {
      return c.body(null, 204);
    }
    return c.json({ token: token.id, createdAt: token.createdAt.toISOString() });
  });
