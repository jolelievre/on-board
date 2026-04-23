import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../middleware/auth.js";

type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

export const playersRoutes = new Hono<AuthEnv>().get(
  "/suggestions",
  async (c) => {
    const user = c.get("user");
    const query = c.req.query("q") || "";

    // Find distinct player names from matches created by this user
    const players = await prisma.player.findMany({
      where: {
        match: { createdById: user.id },
        ...(query
          ? { name: { contains: query, mode: "insensitive" as const } }
          : {}),
      },
      distinct: ["name"],
      select: { name: true },
      orderBy: { name: "asc" },
      take: 20,
    });

    return c.json(players.map((p) => p.name));
  },
);
