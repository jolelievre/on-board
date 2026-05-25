import { test, expect } from "@playwright/test";
import { createAndSignIn } from "../helpers/auth";
import type { ApiProfile } from "../../src/client/lib/api-types";

function makeClientId(): string {
  let hex = "";
  for (let i = 0; i < 24; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `c${hex}`;
}

test.describe("API: Profiles (authenticated)", () => {
  test("GET /api/profiles returns a self-Profile for a fresh user", async ({
    request,
  }) => {
    // createAndSignIn signs up via the email/password endpoint, which
    // fires the user.create.after hook → auto-provisions the
    // self-Profile.
    const user = await createAndSignIn(request);

    const res = await request.get("/api/profiles");
    expect(res.ok()).toBeTruthy();

    const profiles = (await res.json()) as ApiProfile[];
    const self = profiles.find((p) => p.linkedUserId === p.ownerId);
    expect(self).toBeDefined();
    expect(self?.alias).toBe(user.name);
    expect(self?.linkedUser).not.toBeNull();
  });

  test("POST /api/profiles creates an unclaimed profile owned by the caller", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const meRes = await request.get("/api/auth/get-session");
    const me = await meRes.json();

    const id = makeClientId();
    const res = await request.post("/api/profiles", {
      data: { id, alias: "Alice" },
    });
    expect(res.status()).toBe(201);

    const profile = (await res.json()) as ApiProfile;
    expect(profile.id).toBe(id);
    expect(profile.ownerId).toBe(me.user.id);
    expect(profile.linkedUserId).toBeNull();
    expect(profile.alias).toBe("Alice");
    expect(profile.useLinkedAvatar).toBe(true);
  });

  test("POST /api/profiles is idempotent on client-supplied id", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const id = makeClientId();

    const first = await request.post("/api/profiles", {
      data: { id, alias: "Alice" },
    });
    expect(first.status()).toBe(201);

    const second = await request.post("/api/profiles", {
      data: { id, alias: "Whatever" },
    });
    expect(second.status()).toBe(200);
    const profile = (await second.json()) as ApiProfile;
    // Idempotent: existing record returned unchanged (alias not
    // overwritten by the replay).
    expect(profile.alias).toBe("Alice");
  });

  test("POST /api/profiles rejects an id already owned by another user", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const id = makeClientId();
    const create = await request.post("/api/profiles", {
      data: { id, alias: "Alice" },
    });
    expect(create.status()).toBe(201);

    // Switch to a second user — sign-up resets the session cookie on
    // the request context.
    await createAndSignIn(request);
    const collision = await request.post("/api/profiles", {
      data: { id, alias: "Stolen" },
    });
    expect(collision.status()).toBe(403);
  });

  test("POST /api/profiles rejects empty alias", async ({ request }) => {
    await createAndSignIn(request);
    const res = await request.post("/api/profiles", {
      data: { alias: "   " },
    });
    expect(res.status()).toBe(400);
  });

  test("PATCH /api/profiles/:id updates alias and useLinkedAvatar", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const create = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const profile = (await create.json()) as ApiProfile;

    const patched = await request.patch(`/api/profiles/${profile.id}`, {
      data: { alias: "Bob", useLinkedAvatar: false },
    });
    expect(patched.status()).toBe(200);
    const updated = (await patched.json()) as ApiProfile;
    expect(updated.alias).toBe("Bob");
    expect(updated.useLinkedAvatar).toBe(false);
  });

  test("PATCH /api/profiles/:id forbids non-owners", async ({ request }) => {
    await createAndSignIn(request);
    const create = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const profile = (await create.json()) as ApiProfile;

    await createAndSignIn(request); // new user
    const patched = await request.patch(`/api/profiles/${profile.id}`, {
      data: { alias: "Bob" },
    });
    expect(patched.status()).toBe(403);
  });

  test("GET /api/profiles applies visibility filter (other-owner profiles invisible)", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const create = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const aliceProfile = (await create.json()) as ApiProfile;

    await createAndSignIn(request); // new user
    const res = await request.get("/api/profiles");
    expect(res.ok()).toBeTruthy();
    const profiles = (await res.json()) as ApiProfile[];
    expect(profiles.find((p) => p.id === aliceProfile.id)).toBeUndefined();
  });

  test("GET /api/profiles?since= filters by updatedAt", async ({
    request,
  }) => {
    await createAndSignIn(request);
    // Self profile already exists. Wait a tick so updatedAt sorts cleanly.
    await new Promise((r) => setTimeout(r, 30));
    const cursor = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 30));

    const create = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const created = (await create.json()) as ApiProfile;

    const res = await request.get(
      `/api/profiles?since=${encodeURIComponent(cursor)}`,
    );
    expect(res.ok()).toBeTruthy();
    const profiles = (await res.json()) as ApiProfile[];
    const ids = profiles.map((p) => p.id);
    expect(ids).toContain(created.id);
  });

  test("POST /api/matches resolves each player to a Profile", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const matchRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Alice", position: 0 },
          { name: "Bob", position: 1 },
        ],
      },
    });
    expect(matchRes.status()).toBe(201);
    const match = (await matchRes.json()) as {
      players: { name: string; profileId: string | null }[];
    };

    for (const player of match.players) {
      expect(player.profileId).not.toBeNull();
    }
    expect(match.players[0].profileId).not.toBe(match.players[1].profileId);
  });

  test("POST /api/matches reuses an existing Profile when the alias matches", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const first = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Alice", position: 0 },
          { name: "Bob", position: 1 },
        ],
      },
    });
    const firstMatch = (await first.json()) as {
      players: { name: string; profileId: string | null }[];
    };

    const second = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        // Case-insensitive alias match: "alice" should reuse Alice's profile.
        players: [
          { name: "alice", position: 0 },
          { name: "Carol", position: 1 },
        ],
      },
    });
    const secondMatch = (await second.json()) as {
      players: {
        name: string;
        position: number;
        profileId: string | null;
      }[];
    };

    const firstAlice = firstMatch.players.find((p) => p.name === "Alice")!;
    // PR 6-B: Player.name is now snapshotted from the canonical
    // Profile.alias, so the second slot reads "Alice" even though the
    // client passed "alice". Identity comes from profileId, not from
    // the legacy display column.
    const secondAlice = secondMatch.players.find((p) => p.position === 0)!;
    expect(secondAlice.profileId).toBe(firstAlice.profileId);
    expect(secondAlice.name).toBe("Alice");

    // Carol gets a brand-new profile.
    const firstBob = firstMatch.players.find((p) => p.name === "Bob")!;
    const secondCarol = secondMatch.players.find((p) => p.position === 1)!;
    expect(secondCarol.profileId).not.toBe(firstBob.profileId);
    expect(secondCarol.profileId).not.toBe(firstAlice.profileId);
  });

  test("POST /api/matches with userId === self binds the self-Profile", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const meRes = await request.get("/api/auth/get-session");
    const me = await meRes.json();

    const matchRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: me.user.name, position: 0, userId: me.user.id },
          { name: "Friend", position: 1 },
        ],
      },
    });
    const match = (await matchRes.json()) as {
      players: { name: string; profileId: string | null; userId: string | null }[];
    };

    const profilesRes = await request.get("/api/profiles");
    const profiles = (await profilesRes.json()) as ApiProfile[];
    const selfProfile = profiles.find((p) => p.linkedUserId === p.ownerId)!;

    const selfPlayer = match.players.find((p) => p.userId === me.user.id)!;
    expect(selfPlayer.profileId).toBe(selfProfile.id);
  });
});

// Smallest valid PNG (1x1 transparent). sharp resizes it to the
// 400/100 outputs without complaint, and the file is small enough to
// fit inline.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function tinyPngBuffer(): Buffer {
  return Buffer.from(TINY_PNG_BASE64, "base64");
}

test.describe("API: Profile avatars (authenticated)", () => {
  test("POST /api/profiles/:id/avatar resizes + persists customAvatarUrl", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const created = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    expect(created.status()).toBe(201);
    const profile = (await created.json()) as ApiProfile;

    const upload = await request.post(`/api/profiles/${profile.id}/avatar`, {
      multipart: {
        avatar: {
          name: "avatar.png",
          mimeType: "image/png",
          buffer: tinyPngBuffer(),
        },
      },
    });
    expect(upload.status()).toBe(200);
    const updated = (await upload.json()) as ApiProfile;
    expect(updated.customAvatarUrl).toMatch(
      new RegExp(`^/api/uploads/avatars/${profile.id}\\.[a-z0-9]+\\.jpg$`),
    );
    // A custom upload implies the owner wants this one shown.
    expect(updated.useLinkedAvatar).toBe(false);

    // And the file actually serves.
    const file = await request.get(updated.customAvatarUrl as string);
    expect(file.ok()).toBeTruthy();
    expect(file.headers()["content-type"]).toBe("image/jpeg");
  });

  test("POST /api/profiles/:id/avatar rejects when caller doesn't own the profile", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const created = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const profile = (await created.json()) as ApiProfile;

    await createAndSignIn(request); // switch identity
    const upload = await request.post(`/api/profiles/${profile.id}/avatar`, {
      multipart: {
        avatar: {
          name: "avatar.png",
          mimeType: "image/png",
          buffer: tinyPngBuffer(),
        },
      },
    });
    expect(upload.status()).toBe(403);
  });

  test("POST /api/profiles/:id/avatar rejects an empty body", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const created = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const profile = (await created.json()) as ApiProfile;

    const upload = await request.post(`/api/profiles/${profile.id}/avatar`, {
      data: "",
      headers: { "content-type": "application/json" },
    });
    // Body without multipart → either 400 "multipart required" or 400
    // "missing avatar part" depending on which guard fires first.
    expect(upload.status()).toBe(400);
  });

  test("DELETE /api/profiles/:id/avatar clears customAvatarUrl + restores linked default", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const created = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const profile = (await created.json()) as ApiProfile;

    const upload = await request.post(`/api/profiles/${profile.id}/avatar`, {
      multipart: {
        avatar: {
          name: "avatar.png",
          mimeType: "image/png",
          buffer: tinyPngBuffer(),
        },
      },
    });
    expect(upload.status()).toBe(200);

    const clear = await request.delete(`/api/profiles/${profile.id}/avatar`);
    expect(clear.status()).toBe(200);
    const cleared = (await clear.json()) as ApiProfile;
    expect(cleared.customAvatarUrl).toBeNull();
    expect(cleared.useLinkedAvatar).toBe(true);
  });

  test("GET /api/uploads/avatars rejects path-traversal-shaped filenames", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/uploads/avatars/..%2F..%2Fpackage.json",
    );
    expect(res.status()).toBe(404);
  });
});

test.describe("API: Profile merge (authenticated)", () => {
  test("POST /api/profiles/:targetId/merge collapses Player.profileId + deletes source", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const gameRes = await request.get("/api/games/7-wonders-duel");
    const game = await gameRes.json();

    const aliceRes = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const alice = (await aliceRes.json()) as ApiProfile;
    const aliasRes = await request.post("/api/profiles", {
      data: { alias: "Aliss" },
    });
    const alias = (await aliasRes.json()) as ApiProfile;

    // One match references each profile so the merge has rewrites to do.
    const matchRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: alias.id, position: 1 },
        ],
      },
    });
    const match = await matchRes.json();
    const matchId = match.id;

    const merge = await request.post(`/api/profiles/${alice.id}/merge`, {
      data: { sourceProfileId: alias.id },
    });
    expect(merge.status()).toBe(200);
    const body = (await merge.json()) as { status: string; profile: ApiProfile };
    expect(body.status).toBe("merged");
    expect(body.profile.id).toBe(alice.id);

    // Source profile is gone.
    const sourceFetch = await request.get(`/api/profiles`);
    const profiles = (await sourceFetch.json()) as ApiProfile[];
    expect(profiles.some((p) => p.id === alias.id)).toBe(false);

    // The match's second Player now references alice's profile and
    // snapshots her alias to Player.name.
    const detail = await request.get(`/api/matches/${matchId}`);
    const detailBody = (await detail.json()) as {
      players: { profileId: string | null; name: string }[];
    };
    expect(
      detailBody.players.every((p) => p.profileId === alice.id),
    ).toBe(true);
    expect(detailBody.players.every((p) => p.name === "Alice")).toBe(true);
  });

  test("POST /api/profiles/:targetId/merge requires ownership of both profiles", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const aliceRes = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const alice = (await aliceRes.json()) as ApiProfile;

    await createAndSignIn(request);
    const otherRes = await request.post("/api/profiles", {
      data: { alias: "Other" },
    });
    const other = (await otherRes.json()) as ApiProfile;

    const merge = await request.post(`/api/profiles/${other.id}/merge`, {
      data: { sourceProfileId: alice.id },
    });
    // The caller doesn't own alice (it was created under a previous
    // identity), so the resolver returns 403.
    expect(merge.status()).toBe(403);
  });

  test("POST /api/profiles/:targetId/merge rejects when either side is linked", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const selfRes = await request.get("/api/profiles");
    const profiles = (await selfRes.json()) as ApiProfile[];
    const self = profiles.find((p) => p.linkedUserId === p.ownerId)!;

    const otherRes = await request.post("/api/profiles", {
      data: { alias: "Other" },
    });
    const other = (await otherRes.json()) as ApiProfile;

    // self is linked (linkedUserId === viewer.id) — 6-B refuses linked
    // merges; the token-required variant ships in 6-C.
    const merge = await request.post(`/api/profiles/${self.id}/merge`, {
      data: { sourceProfileId: other.id },
    });
    expect(merge.status()).toBe(409);
  });

  test("POST /api/profiles/:targetId/merge rejects same-id payload", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const aliceRes = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const alice = (await aliceRes.json()) as ApiProfile;

    const merge = await request.post(`/api/profiles/${alice.id}/merge`, {
      data: { sourceProfileId: alice.id },
    });
    expect(merge.status()).toBe(400);
  });
});

test.describe("API: Profile link / unlink (authenticated)", () => {
  test("POST /api/profiles/link-token returns a token attesting the caller's id", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const meRes = await request.get("/api/auth/get-session");
    const me = await meRes.json();

    const res = await request.post("/api/profiles/link-token");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { token: string; expiresAt: string };
    expect(typeof body.token).toBe("string");
    expect(body.token.split(".")).toHaveLength(2);

    // The future-dated expiry should be ~60s from now; allow loose
    // bounds so a slow CI doesn't flake.
    const expMs = new Date(body.expiresAt).getTime();
    const delta = expMs - Date.now();
    expect(delta).toBeGreaterThan(30_000);
    expect(delta).toBeLessThan(90_000);

    // The token payload should encode the caller's user id (base64url-decode).
    const [payloadB64] = body.token.split(".");
    const pad = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/") + pad,
      "base64",
    ).toString("utf8");
    const payload = JSON.parse(json) as { userId: string };
    expect(payload.userId).toBe(me.user.id);
  });

  test("POST /api/profiles/:id/link binds an unclaimed profile to the friend's User", async ({
    request,
  }) => {
    // Friend B signs in and mints a token attesting their identity.
    await createAndSignIn(request);
    const friendMeRes = await request.get("/api/auth/get-session");
    const friendMe = await friendMeRes.json();
    const tokenRes = await request.post("/api/profiles/link-token");
    const { token } = (await tokenRes.json()) as { token: string };

    // Owner A signs in (replacing the session cookie) and creates an
    // unclaimed profile for "Alice".
    await createAndSignIn(request);
    const createRes = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const alice = (await createRes.json()) as ApiProfile;

    const linkRes = await request.post(`/api/profiles/${alice.id}/link`, {
      data: { token },
    });
    expect(linkRes.status()).toBe(200);
    const body = (await linkRes.json()) as {
      status: string;
      profile: ApiProfile;
    };
    expect(body.status).toBe("linked");
    expect(body.profile.linkedUserId).toBe(friendMe.user.id);
    expect(body.profile.linkedUser?.id).toBe(friendMe.user.id);
  });

  test("POST /api/profiles/:id/link is idempotent when already linked to the same friend", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const tokenRes = await request.post("/api/profiles/link-token");
    const { token } = (await tokenRes.json()) as { token: string };

    await createAndSignIn(request);
    const create = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const alice = (await create.json()) as ApiProfile;

    await request.post(`/api/profiles/${alice.id}/link`, { data: { token } });
    // A replay of the same scan should succeed, not 409.
    const replay = await request.post(`/api/profiles/${alice.id}/link`, {
      data: { token },
    });
    expect(replay.status()).toBe(200);
    const body = (await replay.json()) as { status: string };
    expect(body.status).toBe("linked");
  });

  test("POST /api/profiles/:id/link merge_required branch (two-user scenario)", async ({
    browser,
  }) => {
    // Use two browser contexts so each session is fully isolated.
    const friendCtx = await browser.newContext();
    const friendReq = friendCtx.request;
    const ownerCtx = await browser.newContext();
    const ownerReq = ownerCtx.request;

    try {
      await createAndSignIn(friendReq);
      const friendMeRes = await friendReq.get("/api/auth/get-session");
      const friendMe = await friendMeRes.json();

      await createAndSignIn(ownerReq);

      // Owner creates two profiles for the same friend by mistake.
      const aleeceRes = await ownerReq.post("/api/profiles", {
        data: { alias: "Aleece" },
      });
      const aleece = (await aleeceRes.json()) as ApiProfile;
      const aliceRes = await ownerReq.post("/api/profiles", {
        data: { alias: "Alice" },
      });
      const alice = (await aliceRes.json()) as ApiProfile;

      // Friend mints a token; owner links "Aleece".
      const tokenA = await friendReq.post("/api/profiles/link-token");
      const { token: tokenAValue } = (await tokenA.json()) as { token: string };
      const link1 = await ownerReq.post(`/api/profiles/${aleece.id}/link`, {
        data: { token: tokenAValue },
      });
      expect(link1.status()).toBe(200);

      // Friend mints a fresh token; owner tries to link the second
      // profile to the same friend.
      const tokenB = await friendReq.post("/api/profiles/link-token");
      const { token: tokenBValue } = (await tokenB.json()) as { token: string };
      const link2 = await ownerReq.post(`/api/profiles/${alice.id}/link`, {
        data: { token: tokenBValue },
      });
      expect(link2.status()).toBe(200);
      const body = (await link2.json()) as {
        status: string;
        existing?: { id: string; alias: string };
        target?: { id: string; alias: string };
      };
      expect(body.status).toBe("merge_required");
      expect(body.existing?.id).toBe(aleece.id);
      expect(body.existing?.alias).toBe("Aleece");
      expect(body.target?.id).toBe(alice.id);

      // No mutation: target stayed unclaimed.
      const profilesRes = await ownerReq.get("/api/profiles");
      const profiles = (await profilesRes.json()) as ApiProfile[];
      const aliceAfter = profiles.find((p) => p.id === alice.id)!;
      expect(aliceAfter.linkedUserId).toBeNull();

      // Confirm: caller follows up with merge { sourceProfileId: alice.id, token }.
      const tokenC = await friendReq.post("/api/profiles/link-token");
      const { token: tokenCValue } = (await tokenC.json()) as { token: string };
      const merge = await ownerReq.post(
        `/api/profiles/${aleece.id}/merge`,
        {
          data: { sourceProfileId: alice.id, token: tokenCValue },
        },
      );
      expect(merge.status()).toBe(200);
      const mergeBody = (await merge.json()) as {
        status: string;
        profile: ApiProfile;
      };
      expect(mergeBody.status).toBe("merged");
      expect(mergeBody.profile.id).toBe(aleece.id);
      expect(mergeBody.profile.linkedUserId).toBe(friendMe.user.id);

      // Source profile is gone.
      const afterRes = await ownerReq.get("/api/profiles");
      const after = (await afterRes.json()) as ApiProfile[];
      expect(after.find((p) => p.id === alice.id)).toBeUndefined();
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("POST /api/profiles/:id/link rejects an expired or tampered token", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const create = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const alice = (await create.json()) as ApiProfile;

    // Malformed token
    const bad1 = await request.post(`/api/profiles/${alice.id}/link`, {
      data: { token: "not-a-token" },
    });
    expect(bad1.status()).toBe(400);

    // Forged signature on a plausible payload
    const fakePayload = Buffer.from(
      JSON.stringify({ userId: "fakeid", exp: Date.now() + 60_000 }),
    )
      .toString("base64")
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const bad2 = await request.post(`/api/profiles/${alice.id}/link`, {
      data: { token: `${fakePayload}.AAAA` },
    });
    expect(bad2.status()).toBe(400);
  });

  test("POST /api/profiles/:id/link refuses scanning your own QR code", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const tokenRes = await request.post("/api/profiles/link-token");
    const { token } = (await tokenRes.json()) as { token: string };

    const profilesRes = await request.get("/api/profiles");
    const profiles = (await profilesRes.json()) as ApiProfile[];
    const self = profiles.find((p) => p.linkedUserId === p.ownerId)!;

    // Try to link the self-profile (already linked to me) — but more
    // importantly, also try linking a brand-new unclaimed profile to
    // myself, which is the actual error path.
    const otherRes = await request.post("/api/profiles", {
      data: { alias: "Mirror" },
    });
    const other = (await otherRes.json()) as ApiProfile;

    const res = await request.post(`/api/profiles/${other.id}/link`, {
      data: { token },
    });
    expect(res.status()).toBe(400);

    // Sanity: self-profile lookup didn't get disturbed.
    expect(self.linkedUserId).toBe(self.ownerId);
  });

  test("POST /api/profiles/:id/link forbids non-owners", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    const thirdCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const tokenRes = await friendCtx.request.post("/api/profiles/link-token");
      const { token } = (await tokenRes.json()) as { token: string };

      await createAndSignIn(ownerCtx.request);
      const create = await ownerCtx.request.post("/api/profiles", {
        data: { alias: "Alice" },
      });
      const alice = (await create.json()) as ApiProfile;

      await createAndSignIn(thirdCtx.request);
      const res = await thirdCtx.request.post(`/api/profiles/${alice.id}/link`, {
        data: { token },
      });
      expect(res.status()).toBe(403);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
      await thirdCtx.close();
    }
  });

  test("POST /api/profiles/:id/link rejects when already linked to a different friend", async ({
    browser,
  }) => {
    const friendACtx = await browser.newContext();
    const friendBCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendACtx.request);
      const tokenA = await friendACtx.request.post("/api/profiles/link-token");
      const { token: tokA } = (await tokenA.json()) as { token: string };

      await createAndSignIn(friendBCtx.request);
      const tokenB = await friendBCtx.request.post("/api/profiles/link-token");
      const { token: tokB } = (await tokenB.json()) as { token: string };

      await createAndSignIn(ownerCtx.request);
      const create = await ownerCtx.request.post("/api/profiles", {
        data: { alias: "Alice" },
      });
      const alice = (await create.json()) as ApiProfile;

      const link1 = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token: tokA } },
      );
      expect(link1.status()).toBe(200);

      const link2 = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token: tokB } },
      );
      expect(link2.status()).toBe(409);
    } finally {
      await friendACtx.close();
      await friendBCtx.close();
      await ownerCtx.close();
    }
  });

  test("POST /api/profiles/:id/unlink reverts a linked profile to unclaimed (owner side)", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const tokenRes = await friendCtx.request.post("/api/profiles/link-token");
      const { token } = (await tokenRes.json()) as { token: string };

      await createAndSignIn(ownerCtx.request);
      const create = await ownerCtx.request.post("/api/profiles", {
        data: { alias: "Alice" },
      });
      const alice = (await create.json()) as ApiProfile;

      const link = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token } },
      );
      expect(link.status()).toBe(200);

      const unlink = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/unlink`,
      );
      expect(unlink.status()).toBe(200);
      const after = (await unlink.json()) as ApiProfile;
      expect(after.linkedUserId).toBeNull();

      // Friend can no longer see the profile.
      const friendProfiles = await friendCtx.request.get("/api/profiles");
      const list = (await friendProfiles.json()) as ApiProfile[];
      expect(list.find((p) => p.id === alice.id)).toBeUndefined();
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("POST /api/profiles/:id/unlink works from the linked user's side too", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const tokenRes = await friendCtx.request.post("/api/profiles/link-token");
      const { token } = (await tokenRes.json()) as { token: string };

      await createAndSignIn(ownerCtx.request);
      const create = await ownerCtx.request.post("/api/profiles", {
        data: { alias: "Alice" },
      });
      const alice = (await create.json()) as ApiProfile;

      const link = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token } },
      );
      expect(link.status()).toBe(200);

      // The friend sees the profile in their list (linkedUserId === friend).
      const friendList = await friendCtx.request.get("/api/profiles");
      const list = (await friendList.json()) as ApiProfile[];
      expect(list.find((p) => p.id === alice.id)).toBeDefined();

      // Friend unlinks themself.
      const unlink = await friendCtx.request.post(
        `/api/profiles/${alice.id}/unlink`,
      );
      expect(unlink.status()).toBe(200);

      // And no longer sees the profile.
      const afterList = await friendCtx.request.get("/api/profiles");
      const after = (await afterList.json()) as ApiProfile[];
      expect(after.find((p) => p.id === alice.id)).toBeUndefined();
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("POST /api/profiles/:id/unlink rejects unrelated third parties", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    const otherCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const tokenRes = await friendCtx.request.post("/api/profiles/link-token");
      const { token } = (await tokenRes.json()) as { token: string };

      await createAndSignIn(ownerCtx.request);
      const create = await ownerCtx.request.post("/api/profiles", {
        data: { alias: "Alice" },
      });
      const alice = (await create.json()) as ApiProfile;
      await ownerCtx.request.post(`/api/profiles/${alice.id}/link`, {
        data: { token },
      });

      await createAndSignIn(otherCtx.request);
      const res = await otherCtx.request.post(
        `/api/profiles/${alice.id}/unlink`,
      );
      expect(res.status()).toBe(403);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
      await otherCtx.close();
    }
  });

  test("POST /api/profiles/:id/unlink refuses to detach the self-profile", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const list = await request.get("/api/profiles");
    const profiles = (await list.json()) as ApiProfile[];
    const self = profiles.find((p) => p.linkedUserId === p.ownerId)!;

    const res = await request.post(`/api/profiles/${self.id}/unlink`);
    expect(res.status()).toBe(409);
  });

  test("POST /api/profiles/:targetId/merge accepts a token to merge linked profiles", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);

      await createAndSignIn(ownerCtx.request);
      const aliceRes = await ownerCtx.request.post("/api/profiles", {
        data: { alias: "Alice" },
      });
      const alice = (await aliceRes.json()) as ApiProfile;
      const aleeceRes = await ownerCtx.request.post("/api/profiles", {
        data: { alias: "Aleece" },
      });
      const aleece = (await aleeceRes.json()) as ApiProfile;

      // Link Aleece to the friend.
      const tokenA = await friendCtx.request.post("/api/profiles/link-token");
      const { token: tokA } = (await tokenA.json()) as { token: string };
      const link = await ownerCtx.request.post(
        `/api/profiles/${aleece.id}/link`,
        { data: { token: tokA } },
      );
      expect(link.status()).toBe(200);

      // Without a token, merging the unclaimed Alice into the linked
      // Aleece must be rejected (target is linked).
      const refused = await ownerCtx.request.post(
        `/api/profiles/${aleece.id}/merge`,
        { data: { sourceProfileId: alice.id } },
      );
      expect(refused.status()).toBe(409);

      // With a fresh token for the same friend, the merge succeeds.
      const tokenB = await friendCtx.request.post("/api/profiles/link-token");
      const { token: tokB } = (await tokenB.json()) as { token: string };
      const ok = await ownerCtx.request.post(
        `/api/profiles/${aleece.id}/merge`,
        { data: { sourceProfileId: alice.id, token: tokB } },
      );
      expect(ok.status()).toBe(200);
      const body = (await ok.json()) as { profile: ApiProfile };
      expect(body.profile.id).toBe(aleece.id);
      expect(body.profile.linkedUserId).not.toBeNull();
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("POST /api/profiles/:targetId/merge with a token for a different friend is still rejected", async ({
    browser,
  }) => {
    const friendACtx = await browser.newContext();
    const friendBCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendACtx.request);
      await createAndSignIn(friendBCtx.request);

      await createAndSignIn(ownerCtx.request);
      const aliceRes = await ownerCtx.request.post("/api/profiles", {
        data: { alias: "Alice" },
      });
      const alice = (await aliceRes.json()) as ApiProfile;
      const aleeceRes = await ownerCtx.request.post("/api/profiles", {
        data: { alias: "Aleece" },
      });
      const aleece = (await aleeceRes.json()) as ApiProfile;

      // Aleece is linked to friend A.
      const tokA = (await (
        await friendACtx.request.post("/api/profiles/link-token")
      ).json()) as { token: string };
      await ownerCtx.request.post(`/api/profiles/${aleece.id}/link`, {
        data: { token: tokA.token },
      });

      // Owner tries to merge with friend B's token — the linked
      // friend doesn't match, so the merge resolver still rejects.
      const tokB = (await (
        await friendBCtx.request.post("/api/profiles/link-token")
      ).json()) as { token: string };
      const merge = await ownerCtx.request.post(
        `/api/profiles/${aleece.id}/merge`,
        { data: { sourceProfileId: alice.id, token: tokB.token } },
      );
      expect(merge.status()).toBe(409);
    } finally {
      await friendACtx.close();
      await friendBCtx.close();
      await ownerCtx.close();
    }
  });
});

test.describe("API: Profiles (unauthenticated)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("GET /api/profiles returns 401 without auth", async ({ request }) => {
    const res = await request.get("/api/profiles");
    expect(res.status()).toBe(401);
  });

  test("POST /api/profiles returns 401 without auth", async ({ request }) => {
    const res = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/profiles/link-token returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post("/api/profiles/link-token");
    expect(res.status()).toBe(401);
  });
});
