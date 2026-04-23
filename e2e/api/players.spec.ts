import { test, expect } from "@playwright/test";
import { createAndSignIn } from "../helpers/auth";

test.describe("API: Players", () => {
  test("GET /api/players/suggestions returns player names", async ({
    request,
  }) => {
    await createAndSignIn(request);

    // Create a match to have some player names
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Alice", position: 0 },
          { name: "Bob", position: 1 },
        ],
      },
    });

    const res = await request.get("/api/players/suggestions");
    expect(res.ok()).toBeTruthy();

    const names = await res.json();
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
  });

  test("GET /api/players/suggestions filters by query", async ({
    request,
  }) => {
    await createAndSignIn(request);

    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Alice", position: 0 },
          { name: "Bob", position: 1 },
        ],
      },
    });

    const res = await request.get("/api/players/suggestions?q=ali");
    expect(res.ok()).toBeTruthy();

    const names = await res.json();
    expect(names).toContain("Alice");
    expect(names).not.toContain("Bob");
  });

  test("GET /api/players/suggestions returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get("/api/players/suggestions");
    expect(res.status()).toBe(401);
  });
});
