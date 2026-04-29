import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../middleware/auth.js";
import { displayPlayerName } from "../../shared/players.js";

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

    // Match scope: matches I created OR matches where I'm a participant.
    // Pull the Player.user relation so we can prefer the linked user's
    // alias / name over the persisted Player.name (which can be stale
    // after a user changes their alias).
    const players = await prisma.player.findMany({
      where: {
        OR: [{ match: { createdById: user.id } }, { userId: user.id }],
      },
      select: {
        name: true,
        userId: true,
        user: { select: { name: true, alias: true } },
      },
      orderBy: { name: "asc" },
      take: 200,
    });

    // Resolve each Player to its display name and de-duplicate
    // case-insensitively. Players linked to the current user are dropped
    // because the always-included self entry below covers them.
    const selfName = user.alias?.trim() || user.name?.trim() || "";
    const seen = new Set<string>();
    const others: PlayerSuggestion[] = [];
    if (selfName) seen.add(selfName.toLowerCase());

    for (const p of players) {
      if (p.userId && p.userId === user.id) continue;
      const display = displayPlayerName(p).trim();
      if (!display) continue;
      const key = display.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      others.push({ name: display, isSelf: false });
    }

    // Apply the search filter at the end so it covers self + resolved
    // names equally.
    const q = query.trim().toLowerCase();
    const matchesQuery = (n: string) =>
      q === "" || n.toLowerCase().includes(q);

    const includeSelf = selfName.length > 0 && matchesQuery(selfName);
    const filteredOthers = others
      .filter((o) => matchesQuery(o.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20);

    const out: PlayerSuggestion[] = includeSelf
      ? [{ name: selfName, isSelf: true }, ...filteredOthers]
      : filteredOthers;

    return c.json(out);
  },
);
