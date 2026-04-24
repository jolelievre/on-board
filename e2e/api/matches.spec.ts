import { test, expect } from "@playwright/test";

test.describe("API: Matches (authenticated)", () => {
  // These tests use the stored auth state from the setup project

  test("POST /api/matches creates a match", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Alice", position: 0 },
          { name: "Bob", position: 1 },
        ],
      },
    });

    expect(res.status()).toBe(201);
    const match = await res.json();
    expect(match.gameId).toBe(game.id);
    expect(match.status).toBe("IN_PROGRESS");
    expect(match.players).toHaveLength(2);
  });

  test("POST /api/matches rejects invalid player count", async ({
    request,
  }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [{ name: "Alice", position: 0 }],
      },
    });

    expect(res.status()).toBe(400);
  });

  test("POST /api/matches rejects missing gameId", async ({ request }) => {
    const res = await request.post("/api/matches", {
      data: { players: [{ name: "Alice", position: 0 }] },
    });

    expect(res.status()).toBe(400);
  });

  test("GET /api/matches lists user matches", async ({ request }) => {
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

    const res = await request.get("/api/matches");
    expect(res.ok()).toBeTruthy();

    const matches = await res.json();
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  test("GET /api/matches/:id returns match details", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Alice", position: 0 },
          { name: "Bob", position: 1 },
        ],
      },
    });
    const created = await createRes.json();

    const res = await request.get(`/api/matches/${created.id}`);
    expect(res.ok()).toBeTruthy();

    const match = await res.json();
    expect(match.id).toBe(created.id);
    expect(match.players).toHaveLength(2);
    expect(match.game).toBeDefined();
  });

  test("PUT /api/matches/:id updates match status", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Alice", position: 0 },
          { name: "Bob", position: 1 },
        ],
      },
    });
    const created = await createRes.json();

    const res = await request.put(`/api/matches/${created.id}`, {
      data: {
        status: "COMPLETED",
        victoryType: "score",
        winnerId: created.players[0].id,
      },
    });

    expect(res.ok()).toBeTruthy();
    const match = await res.json();
    expect(match.status).toBe("COMPLETED");
    expect(match.victoryType).toBe("score");
    expect(match.winnerId).toBe(created.players[0].id);
    expect(match.completedAt).toBeTruthy();
  });

  test("PUT /api/matches/:id rejects invalid winnerId", async ({
    request,
  }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Alice", position: 0 },
          { name: "Bob", position: 1 },
        ],
      },
    });
    const created = await createRes.json();

    const res = await request.put(`/api/matches/${created.id}`, {
      data: { winnerId: "nonexistent-player-id" },
    });

    expect(res.status()).toBe(400);
  });
});

test.describe("API: Matches (unauthenticated)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("POST /api/matches returns 401 without auth", async ({ request }) => {
    const res = await request.post("/api/matches", {
      data: { gameId: "test", players: [] },
    });

    expect(res.status()).toBe(401);
  });
});
