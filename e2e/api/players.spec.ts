import { test, expect } from "@playwright/test";
import { createAndSignIn } from "../helpers/auth";

type Suggestion = { name: string; isSelf: boolean };

test.describe("API: Players (authenticated)", () => {
  test("GET /api/players/suggestions returns player names", async ({
    request,
  }) => {
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

    const suggestions = (await res.json()) as Suggestion[];
    const names = suggestions.map((s) => s.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
  });

  test("GET /api/players/suggestions filters by query", async ({
    request,
  }) => {
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

    const suggestions = (await res.json()) as Suggestion[];
    const names = suggestions.map((s) => s.name);
    expect(names).toContain("Alice");
    expect(names).not.toContain("Bob");
  });

  test("GET /api/players/suggestions always includes the current user as self", async ({
    request,
  }) => {
    // Fresh user with no match history → suggestions still surface them.
    const user = await createAndSignIn(request);

    const res = await request.get("/api/players/suggestions");
    expect(res.ok()).toBeTruthy();

    const suggestions = (await res.json()) as Suggestion[];
    const self = suggestions.find((s) => s.isSelf);
    expect(self).toBeDefined();
    expect(self?.name).toBe(user.name);
  });

  test("POST /api/matches accepts userId === current user (self-attribution)", async ({
    request,
  }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const meRes = await request.get("/api/auth/get-session");
    const session = await meRes.json();
    const myUserId = session.user.id as string;
    const myName = session.user.name as string;

    const matchRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: myName, position: 0, userId: myUserId },
          { name: "Friend", position: 1 },
        ],
      },
    });
    expect(matchRes.ok()).toBeTruthy();

    const match = await matchRes.json();
    const me = match.players.find(
      (p: { name: string }) => p.name === myName,
    ) as { userId: string | null };
    expect(me.userId).toBe(myUserId);
  });

  test("POST /api/matches rejects userId belonging to another user", async ({
    request,
  }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const matchRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Friend", position: 0, userId: "some-other-user-id" },
          { name: "Other", position: 1 },
        ],
      },
    });

    expect(matchRes.status()).toBe(403);
  });
});

test.describe("API: Players (unauthenticated)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("GET /api/players/suggestions returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get("/api/players/suggestions");
    expect(res.status()).toBe(401);
  });
});
