import { test, expect } from "@playwright/test";

async function createTestMatch(
  request: import("@playwright/test").APIRequestContext,
) {
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

  return createRes.json();
}

test.describe("API: Scores (authenticated)", () => {
  test("PATCH /api/matches/:id/scores saves scores", async ({ request }) => {
    const match = await createTestMatch(request);

    const res = await request.patch(`/api/matches/${match.id}/scores`, {
      data: {
        scores: [
          {
            playerId: match.players[0].id,
            category: "military",
            value: 5,
          },
          {
            playerId: match.players[1].id,
            category: "military",
            value: 3,
          },
        ],
      },
    });

    expect(res.ok()).toBeTruthy();
    const scores = await res.json();
    expect(scores).toHaveLength(2);
  });

  test("PATCH /api/matches/:id/scores upserts existing scores", async ({
    request,
  }) => {
    const match = await createTestMatch(request);

    // Save initial score
    await request.patch(`/api/matches/${match.id}/scores`, {
      data: {
        scores: [
          {
            playerId: match.players[0].id,
            category: "military",
            value: 5,
          },
        ],
      },
    });

    // Update score
    const res = await request.patch(`/api/matches/${match.id}/scores`, {
      data: {
        scores: [
          {
            playerId: match.players[0].id,
            category: "military",
            value: 8,
          },
        ],
      },
    });

    expect(res.ok()).toBeTruthy();
    const scores = await res.json();
    expect(scores).toHaveLength(1);
    expect(scores[0].value).toBe(8);
  });

  test("PATCH /api/matches/:id/scores rejects invalid playerId", async ({
    request,
  }) => {
    const match = await createTestMatch(request);

    const res = await request.patch(`/api/matches/${match.id}/scores`, {
      data: {
        scores: [
          {
            playerId: "nonexistent-player",
            category: "military",
            value: 5,
          },
        ],
      },
    });

    expect(res.status()).toBe(400);
  });

  test("PATCH /api/matches/:id/scores rejects non-integer value", async ({
    request,
  }) => {
    const match = await createTestMatch(request);

    const res = await request.patch(`/api/matches/${match.id}/scores`, {
      data: {
        scores: [
          {
            playerId: match.players[0].id,
            category: "military",
            value: 5.5,
          },
        ],
      },
    });

    expect(res.status()).toBe(400);
  });
});

test.describe("API: Scores (unauthenticated)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("PATCH /api/matches/:id/scores returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.patch("/api/matches/fake-id/scores", {
      data: { scores: [] },
    });

    expect(res.status()).toBe(401);
  });
});
