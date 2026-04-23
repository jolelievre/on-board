import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";

export const gamesRoutes = new Hono()
  .get("/", async (c) => {
    const games = await prisma.game.findMany({
      orderBy: { name: "asc" },
    });
    return c.json(games);
  })
  .get("/:slug", async (c) => {
    const game = await prisma.game.findUnique({
      where: { slug: c.req.param("slug") },
    });
    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }
    return c.json(game);
  });
