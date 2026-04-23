import { test, expect } from "@playwright/test";

test.describe("API: Games", () => {
  test("GET /api/games returns seeded game templates", async ({ request }) => {
    const res = await request.get("/api/games");
    expect(res.ok()).toBeTruthy();

    const games = await res.json();
    expect(games).toHaveLength(2);

    const slugs = games.map((g: { slug: string }) => g.slug);
    expect(slugs).toContain("7-wonders-duel");
    expect(slugs).toContain("skull-king");
  });

  test("GET /api/games/:slug returns a specific game", async ({ request }) => {
    const res = await request.get("/api/games/7-wonders-duel");
    expect(res.ok()).toBeTruthy();

    const game = await res.json();
    expect(game.slug).toBe("7-wonders-duel");
    expect(game.name).toBe("7 Wonders Duel");
    expect(game.minPlayers).toBe(2);
    expect(game.maxPlayers).toBe(2);
  });

  test("GET /api/games/:slug returns 404 for unknown game", async ({
    request,
  }) => {
    const res = await request.get("/api/games/nonexistent-game");
    expect(res.status()).toBe(404);
  });
});
