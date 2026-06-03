import { test, expect, type APIRequestContext } from "@playwright/test";
import { createAndSignIn } from "../helpers/auth";
import {
  createProfile as createProfileApi,
  mintLinkToken,
  signUpContext,
} from "../helpers/api";

async function createProfile(
  request: APIRequestContext,
  alias: string,
): Promise<{ id: string; alias: string }> {
  const res = await request.post("/api/profiles", { data: { alias } });
  if (!res.ok())
    throw new Error(`profile create failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; alias: string };
}

async function createCompletedMatch(
  request: APIRequestContext,
): Promise<{ matchId: string; aliceAlias: string; bobAlias: string; winnerId: string }> {
  const gamesRes = await request.get("/api/games/7-wonders-duel");
  const game = await gamesRes.json();
  const alice = await createProfile(request, "Alice");
  const bob = await createProfile(request, "Bob");

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

  // Drop a score on each player so the public payload has totals to surface.
  await request.patch(`/api/matches/${created.id}/scores`, {
    data: {
      scores: [
        { playerId: created.players[0].id, category: "civil", value: 20 },
        { playerId: created.players[1].id, category: "civil", value: 12 },
      ],
    },
  });

  await request.put(`/api/matches/${created.id}`, {
    data: {
      status: "COMPLETED",
      victoryType: "score",
      winnerId: created.players[0].id,
    },
  });

  return {
    matchId: created.id,
    aliceAlias: alice.alias,
    bobAlias: bob.alias,
    winnerId: created.players[0].id,
  };
}

test.describe("API: Share token (participant mutations)", () => {
  test("POST /api/matches/:id/share-token creates a token on a completed match", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const { matchId } = await createCompletedMatch(request);

    const res = await request.post(`/api/matches/${matchId}/share-token`);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(typeof body.createdAt).toBe("string");
  });

  test("POST is idempotent — second call returns same token (200)", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const { matchId } = await createCompletedMatch(request);

    const first = await request.post(`/api/matches/${matchId}/share-token`);
    expect(first.status()).toBe(201);
    const a = await first.json();

    const second = await request.post(`/api/matches/${matchId}/share-token`);
    expect(second.status()).toBe(200);
    const b = await second.json();
    expect(b.token).toBe(a.token);
  });

  test("POST refuses users with no visibility into the match (404)", async ({
    request,
  }) => {
    // Visibility — not ownership — gates the share endpoints. A user
    // who didn't participate (and who the creator never linked) has no
    // claim on the match and gets the same shape as "match not found".
    await createAndSignIn(request);
    const { matchId } = await createCompletedMatch(request);

    await createAndSignIn(request);
    const res = await request.post(`/api/matches/${matchId}/share-token`);
    expect(res.status()).toBe(404);
  });

  test("non-creator participant can mint a share token (linked friend)", async ({
    browser,
  }) => {
    // A creates a match including A's friend-profile for B, then
    // bilaterally links it to B. B then mints a share token — they're
    // not the creator but they're a visible participant.
    const aCtx = await browser.newContext();
    const bCtx = await browser.newContext();
    try {
      await signUpContext(aCtx);
      await signUpContext(bCtx);

      // Establish bilateral link first so the Player rows on the match
      // carry the right `profileLinkedUserId` denormalisation.
      const aBProfile = await createProfileApi(aCtx.request, "B-friend");
      const bAProfile = await createProfileApi(bCtx.request, "A-friend");
      const bToken = await mintLinkToken(bCtx.request, bAProfile.id);
      const linkRes = await aCtx.request.post(
        `/api/profiles/${aBProfile.id}/link`,
        { data: { token: bToken } },
      );
      expect(linkRes.ok()).toBeTruthy();

      // A creates + completes a 7WD match with A-self + linked B.
      const gameRes = await aCtx.request.get("/api/games/7-wonders-duel");
      const game = (await gameRes.json()) as { id: string };
      const aSelfTemp = await createProfileApi(aCtx.request, "A-self-temp");
      const createRes = await aCtx.request.post("/api/matches", {
        data: {
          gameId: game.id,
          players: [
            { profileId: aSelfTemp.id, position: 0 },
            { profileId: aBProfile.id, position: 1 },
          ],
        },
      });
      const created = (await createRes.json()) as {
        id: string;
        players: { id: string }[];
      };
      await aCtx.request.put(`/api/matches/${created.id}`, {
        data: {
          status: "COMPLETED",
          victoryType: "score",
          winnerId: created.players[0].id,
        },
      });

      // B mints the share token via their own session — they aren't
      // the creator, but the match is visible via the linked profile.
      const bShareRes = await bCtx.request.post(
        `/api/matches/${created.id}/share-token`,
      );
      expect(bShareRes.status()).toBe(201);
      const bShareBody = (await bShareRes.json()) as { token: string };
      expect(typeof bShareBody.token).toBe("string");
    } finally {
      await aCtx.close();
      await bCtx.close();
    }
  });

  test("POST refuses in-progress matches (400)", async ({ request }) => {
    await createAndSignIn(request);
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const alice = await createProfile(request, "Alice");
    const bob = await createProfile(request, "Bob");
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

    const res = await request.post(`/api/matches/${created.id}/share-token`);
    expect(res.status()).toBe(400);
  });

  test("DELETE removes the token and revokes the public link", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const { matchId } = await createCompletedMatch(request);

    const create = await request.post(`/api/matches/${matchId}/share-token`);
    const { token } = await create.json();

    const beforeRevoke = await request.get(`/api/share/${token}`);
    expect(beforeRevoke.status()).toBe(200);

    const del = await request.delete(`/api/matches/${matchId}/share-token`);
    expect(del.status()).toBe(204);

    const afterRevoke = await request.get(`/api/share/${token}`);
    expect(afterRevoke.status()).toBe(404);
  });

  test("GET /api/matches/:id/share-token hydrates the existing token", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const { matchId } = await createCompletedMatch(request);

    const before = await request.get(`/api/matches/${matchId}/share-token`);
    expect(before.status()).toBe(204);

    const created = await request.post(`/api/matches/${matchId}/share-token`);
    const { token } = await created.json();

    const after = await request.get(`/api/matches/${matchId}/share-token`);
    expect(after.status()).toBe(200);
    const body = await after.json();
    expect(body.token).toBe(token);
  });
});

test.describe("API: Public share endpoint", () => {
  test("GET /api/share/:token returns minimal payload with no identity leakage", async ({
    request,
    playwright,
  }) => {
    await createAndSignIn(request);
    const { matchId, aliceAlias, bobAlias } =
      await createCompletedMatch(request);
    const tokenRes = await request.post(`/api/matches/${matchId}/share-token`);
    const { token } = await tokenRes.json();

    // Fresh context with no cookies — the endpoint is public, so this
    // hits it as anyone-on-the-internet would.
    const anon = await playwright.request.newContext({
      baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    });
    const res = await anon.get(`/api/share/${token}`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.game.slug).toBe("7-wonders-duel");
    expect(body.victoryType).toBe("score");
    expect(typeof body.completedAt).toBe("string");
    expect(Array.isArray(body.players)).toBe(true);
    expect(body.players).toHaveLength(2);
    const aliasSet = new Set(body.players.map((p: { alias: string }) => p.alias));
    expect(aliasSet.has(aliceAlias)).toBe(true);
    expect(aliasSet.has(bobAlias)).toBe(true);
    const winner = body.players.find(
      (p: { isWinner: boolean }) => p.isWinner === true,
    );
    expect(winner).toBeTruthy();
    expect(winner.alias).toBe(aliceAlias);
    expect(winner.score).toBe(20);

    // No identity leakage: no profileId, no createdById, no userId.
    for (const p of body.players) {
      expect(p.profileId).toBeUndefined();
      expect(p.createdById).toBeUndefined();
      expect(p.userId).toBeUndefined();
    }
    expect(body.createdById).toBeUndefined();

    await anon.dispose();
  });

  test("GET /api/share/:token returns 404 for unknown token", async ({
    request,
  }) => {
    const res = await request.get("/api/share/does-not-exist");
    expect(res.status()).toBe(404);
  });
});
