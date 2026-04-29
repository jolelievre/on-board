import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../middleware/auth.js";

type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

export type PlayerSuggestion = {
  name: string;
  /** True only for the entry that represents the current user themselves.
   * Clients use this to send `userId` on POST /api/matches and avoid
   * attaching unrelated friends-with-the-same-name to the user account. */
  isSelf: boolean;
};

export const playersRoutes = new Hono<AuthEnv>().get(
  "/suggestions",
  async (c) => {
    const user = c.get("user");
    const query = c.req.query("q") || "";

    // Match scope: matches I created OR matches where I'm a participant
    // (Player.userId === user.id). The latter catches "I played in a match
    // someone else created" — provided the creator chose to attribute me.
    const players = await prisma.player.findMany({
      where: {
        OR: [{ match: { createdById: user.id } }, { userId: user.id }],
        ...(query
          ? { name: { contains: query, mode: "insensitive" as const } }
          : {}),
      },
      distinct: ["name"],
      select: { name: true },
      orderBy: { name: "asc" },
      take: 20,
    });

    // Always include the current user's own name as a flagged suggestion,
    // even when they've never been added to a match yet.
    const selfName = user.name?.trim() ?? "";
    const matchesQuery =
      !query || selfName.toLowerCase().includes(query.toLowerCase());
    const includeSelf = selfName.length > 0 && matchesQuery;

    const others: PlayerSuggestion[] = players
      .map((p) => p.name)
      .filter((n) => n !== selfName)
      .map((n) => ({ name: n, isSelf: false }));

    const out: PlayerSuggestion[] = includeSelf
      ? [{ name: selfName, isSelf: true }, ...others]
      : others;

    return c.json(out);
  },
);
