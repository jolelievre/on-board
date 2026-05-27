import { test, expect, type APIRequestContext } from "@playwright/test";
import { createAndSignIn } from "../helpers/auth";

// CUID-shaped id (lowercase a-z prefix + 24 hex chars). Matches the regex
// the server uses to validate client-supplied ids.
function makeClientId(): string {
  let hex = "";
  for (let i = 0; i < 24; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `c${hex}`;
}

async function createProfile(
  request: APIRequestContext,
  alias: string,
): Promise<{ id: string; alias: string }> {
  const res = await request.post("/api/profiles", { data: { alias } });
  if (!res.ok())
    throw new Error(`profile create failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; alias: string };
}

async function createProfilePair(
  request: APIRequestContext,
): Promise<[{ id: string; alias: string }, { id: string; alias: string }]> {
  const a = await createProfile(request, "Alice");
  const b = await createProfile(request, "Bob");
  return [a, b];
}

test.describe("API: Matches (authenticated)", () => {
  test("POST /api/matches creates a match", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
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
    const alice = await createProfile(request, "Alice");

    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [{ profileId: alice.id, position: 0 }],
      },
    });

    expect(res.status()).toBe(400);
  });

  test("POST /api/matches rejects missing gameId", async ({ request }) => {
    const alice = await createProfile(request, "Alice");
    const res = await request.post("/api/matches", {
      data: { players: [{ profileId: alice.id, position: 0 }] },
    });

    expect(res.status()).toBe(400);
  });

  test("GET /api/matches lists user matches", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
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
    const [alice, bob] = await createProfilePair(request);

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
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
    const [alice, bob] = await createProfilePair(request);

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
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
    const [alice, bob] = await createProfilePair(request);

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    const created = await createRes.json();

    const res = await request.put(`/api/matches/${created.id}`, {
      data: { winnerId: "nonexistent-player-id" },
    });

    expect(res.status()).toBe(400);
  });

  test("POST /api/matches with explicit id is idempotent on retry", async ({
    request,
  }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const matchId = makeClientId();
    const playerIds = [makeClientId(), makeClientId()];
    const body = {
      id: matchId,
      gameId: game.id,
      players: [
        { id: playerIds[0], profileId: alice.id, position: 0 },
        { id: playerIds[1], profileId: bob.id, position: 1 },
      ],
    };

    const first = await request.post("/api/matches", { data: body });
    expect(first.status()).toBe(201);
    const firstMatch = await first.json();
    expect(firstMatch.id).toBe(matchId);
    expect(firstMatch.players.map((p: { id: string }) => p.id).sort()).toEqual(
      [...playerIds].sort(),
    );

    const second = await request.post("/api/matches", { data: body });
    expect(second.status()).toBe(200);
    const secondMatch = await second.json();
    expect(secondMatch.id).toBe(matchId);

    // No duplicate row server-side — list filtered to this match returns one.
    const listRes = await request.get(`/api/matches?gameId=${game.id}`);
    const list = (await listRes.json()) as { id: string }[];
    const matching = list.filter((m) => m.id === matchId);
    expect(matching).toHaveLength(1);
  });

  test("POST /api/matches rejects an id already owned by another user", async ({
    request,
  }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [aliceOwner, bobOwner] = await createProfilePair(request);

    const matchId = makeClientId();
    const ownerRes = await request.post("/api/matches", {
      data: {
        id: matchId,
        gameId: game.id,
        players: [
          { profileId: aliceOwner.id, position: 0 },
          { profileId: bobOwner.id, position: 1 },
        ],
      },
    });
    expect(ownerRes.status()).toBe(201);

    // Switch identity to a fresh user (replaces the session cookie on
    // `request`) and re-attempt to POST with the same match id.
    await createAndSignIn(request);
    const carol = await createProfile(request, "Carol");
    const dave = await createProfile(request, "Dave");

    const conflictRes = await request.post("/api/matches", {
      data: {
        id: matchId,
        gameId: game.id,
        players: [
          { profileId: carol.id, position: 0 },
          { profileId: dave.id, position: 1 },
        ],
      },
    });
    expect(conflictRes.status()).toBe(403);
  });

  test("POST /api/matches rejects a malformed id", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const res = await request.post("/api/matches", {
      data: {
        id: "draft_not_a_cuid",
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    expect(res.status()).toBe(400);
  });

  test("GET /api/matches?since= returns only matches updated after the cursor", async ({
    request,
  }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    // Isolate this test from any pre-existing matches by signing in as a
    // fresh user.
    await createAndSignIn(request);
    const [alice, bob] = await createProfilePair(request);

    const beforeRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    const beforeMatch = await beforeRes.json();

    // Cursor sits after the first match's updatedAt. The server filter is
    // `updatedAt > since` (strict), so the first match must not come back.
    const cursor = beforeMatch.updatedAt as string;

    const carol = await createProfile(request, "Carol");
    const dave = await createProfile(request, "Dave");
    const afterRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: carol.id, position: 0 },
          { profileId: dave.id, position: 1 },
        ],
      },
    });
    const afterMatch = await afterRes.json();

    const filteredRes = await request.get(
      `/api/matches?since=${encodeURIComponent(cursor)}`,
    );
    expect(filteredRes.ok()).toBeTruthy();
    const filtered = (await filteredRes.json()) as { id: string }[];
    const ids = filtered.map((m) => m.id);
    expect(ids).toContain(afterMatch.id);
    expect(ids).not.toContain(beforeMatch.id);
  });

  test("GET /api/matches?since= rejects a malformed timestamp", async ({
    request,
  }) => {
    const res = await request.get("/api/matches?since=not-a-date");
    expect(res.status()).toBe(400);
  });

  test("POST /api/matches stores and returns metadata", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
        metadata: { skullKing: { dealerStart: 1 } },
      },
    });

    expect(res.status()).toBe(201);
    const match = await res.json();
    expect(match.metadata).toEqual({ skullKing: { dealerStart: 1 } });
  });

  test("POST /api/matches accepts profileId and projects Profile.alias on the player row", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const profileA = await createProfile(request, "Alice");
    const profileB = await createProfile(request, "Bob");

    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: profileA.id, position: 0 },
          { profileId: profileB.id, position: 1 },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const match = (await res.json()) as {
      players: { profileId: string; profile: { alias: string }; position: number }[];
    };
    expect(match.players).toHaveLength(2);
    const p0 = match.players.find((p) => p.position === 0)!;
    const p1 = match.players.find((p) => p.position === 1)!;
    expect(p0.profileId).toBe(profileA.id);
    expect(p0.profile.alias).toBe("Alice");
    expect(p1.profileId).toBe(profileB.id);
    expect(p1.profile.alias).toBe("Bob");
  });

  test("POST /api/matches rejects a profileId not visible to the caller", async ({
    request,
  }) => {
    const ownerGamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await ownerGamesRes.json();

    await createAndSignIn(request);
    const ownerProfile = await createProfile(request, "Private");

    // Switch identity — the new user can't see ownerProfile.
    await createAndSignIn(request);
    const bob = await createProfile(request, "Bob");
    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: ownerProfile.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    expect(res.status()).toBe(403);
  });

  test("POST /api/matches rejects a player payload without profileId", async ({
    request,
  }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const bob = await createProfile(request, "Bob");

    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/matches rejects a malformed profileId", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const bob = await createProfile(request, "Bob");

    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: "not-a-cuid", position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/matches returns 404 for an unknown profileId", async ({
    request,
  }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const bob = await createProfile(request, "Bob");

    const res = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: makeClientId(), position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("API: PATCH /api/matches/:id (authenticated)", () => {
  test("updates metadata", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    const created = await createRes.json();

    const res = await request.patch(`/api/matches/${created.id}`, {
      data: { metadata: { foo: "bar", count: 42 } },
    });

    expect(res.ok()).toBeTruthy();
    const match = await res.json();
    expect(match.id).toBe(created.id);
    expect(match.metadata).toEqual({ foo: "bar", count: 42 });
  });

  test("reorders players", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    const created = await createRes.json();
    const alicePlayer = created.players.find(
      (p: { profileId: string }) => p.profileId === alice.id,
    )!;
    const bobPlayer = created.players.find(
      (p: { profileId: string }) => p.profileId === bob.id,
    )!;

    const res = await request.patch(`/api/matches/${created.id}`, {
      data: {
        playerOrder: [
          { playerId: alicePlayer.id, position: 1 },
          { playerId: bobPlayer.id, position: 0 },
        ],
      },
    });

    expect(res.ok()).toBeTruthy();
    const match = await res.json();
    expect(match.players[0].id).toBe(bobPlayer.id);
    expect(match.players[1].id).toBe(alicePlayer.id);
  });

  test("updates metadata and player order together", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    const created = await createRes.json();
    const alicePlayer = created.players.find(
      (p: { profileId: string }) => p.profileId === alice.id,
    )!;
    const bobPlayer = created.players.find(
      (p: { profileId: string }) => p.profileId === bob.id,
    )!;

    const res = await request.patch(`/api/matches/${created.id}`, {
      data: {
        metadata: { gameVariant: "classic" },
        playerOrder: [
          { playerId: alicePlayer.id, position: 1 },
          { playerId: bobPlayer.id, position: 0 },
        ],
      },
    });

    expect(res.ok()).toBeTruthy();
    const match = await res.json();
    expect(match.metadata).toEqual({ gameVariant: "classic" });
    expect(match.players[0].id).toBe(bobPlayer.id);
    expect(match.players[1].id).toBe(alicePlayer.id);
  });

  test("rejects editing a completed match", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    const created = await createRes.json();

    await request.put(`/api/matches/${created.id}`, {
      data: {
        status: "COMPLETED",
        victoryType: "score",
        winnerId: created.players[0].id,
      },
    });

    const res = await request.patch(`/api/matches/${created.id}`, {
      data: { metadata: { skullKing: { dealerStart: 0 } } },
    });

    expect(res.status()).toBe(400);
  });

  test("rejects playerOrder missing a player", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    const created = await createRes.json();
    const alicePlayer = created.players.find(
      (p: { profileId: string }) => p.profileId === alice.id,
    )!;

    const res = await request.patch(`/api/matches/${created.id}`, {
      data: {
        playerOrder: [{ playerId: alicePlayer.id, position: 0 }],
      },
    });

    expect(res.status()).toBe(400);
  });

  test("rejects playerOrder with unknown player id", async ({ request }) => {
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const [alice, bob] = await createProfilePair(request);

    const createRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    const created = await createRes.json();
    const bobPlayer = created.players.find(
      (p: { profileId: string }) => p.profileId === bob.id,
    )!;

    const res = await request.patch(`/api/matches/${created.id}`, {
      data: {
        playerOrder: [
          { playerId: "nonexistent-id", position: 0 },
          { playerId: bobPlayer.id, position: 1 },
        ],
      },
    });

    expect(res.status()).toBe(400);
  });

  test("returns 404 for unknown match", async ({ request }) => {
    const res = await request.patch("/api/matches/nonexistent-id", {
      data: { metadata: {} },
    });

    expect(res.status()).toBe(404);
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
