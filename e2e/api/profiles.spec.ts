import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { createAndSignIn } from "../helpers/auth";
import type { ApiProfile } from "../../src/client/lib/api-types";

function makeClientId(): string {
  let hex = "";
  for (let i = 0; i < 24; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `c${hex}`;
}

// Bilateral-link helpers: a token is now scoped to a specific owned
// profile (the "source"). Tests call `mintLinkToken(req, profile.id)`
// to mint a fresh one. `createProfile` is just a thin wrapper to keep
// the bilateral setup readable in each test.
async function mintLinkToken(
  req: APIRequestContext,
  sourceProfileId: string,
): Promise<string> {
  const res = await req.post(`/api/profiles/${sourceProfileId}/link-token`);
  if (!res.ok()) {
    throw new Error(
      `mintLinkToken ${sourceProfileId} -> ${res.status()} ${await res.text()}`,
    );
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function createProfile(
  req: APIRequestContext,
  alias: string,
): Promise<ApiProfile> {
  const res = await req.post("/api/profiles", { data: { alias } });
  if (!res.ok()) {
    throw new Error(
      `createProfile ${alias} -> ${res.status()} ${await res.text()}`,
    );
  }
  return (await res.json()) as ApiProfile;
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

  test("POST /api/matches binds each Player to its supplied Profile", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const aliceRes = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const alice = (await aliceRes.json()) as ApiProfile;
    const bobRes = await request.post("/api/profiles", {
      data: { alias: "Bob" },
    });
    const bob = (await bobRes.json()) as ApiProfile;

    const matchRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });
    expect(matchRes.status()).toBe(201);
    const match = (await matchRes.json()) as {
      players: { profileId: string; position: number }[];
    };

    expect(match.players[0].profileId).toBe(alice.id);
    expect(match.players[1].profileId).toBe(bob.id);
  });

  test("POST /api/matches lets the same Profile be reused across matches", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const aliceRes = await request.post("/api/profiles", {
      data: { alias: "Alice" },
    });
    const alice = (await aliceRes.json()) as ApiProfile;
    const bobRes = await request.post("/api/profiles", {
      data: { alias: "Bob" },
    });
    const bob = (await bobRes.json()) as ApiProfile;

    await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: bob.id, position: 1 },
        ],
      },
    });

    const carolRes = await request.post("/api/profiles", {
      data: { alias: "Carol" },
    });
    const carol = (await carolRes.json()) as ApiProfile;

    const second = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { profileId: alice.id, position: 0 },
          { profileId: carol.id, position: 1 },
        ],
      },
    });
    const secondMatch = (await second.json()) as {
      players: { profileId: string; position: number }[];
    };
    expect(secondMatch.players[0].profileId).toBe(alice.id);
    expect(secondMatch.players[1].profileId).toBe(carol.id);
  });

  test("POST /api/matches rejects a player payload without profileId", async ({
    request,
  }) => {
    // Under the single-Profile model, every seat must resolve to a
    // Profile before submit. The legacy name-only / userId path is
    // gone — callers that don't migrate get a loud 400.
    await createAndSignIn(request);
    const gamesRes = await request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();

    const matchRes = await request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: "Anyone", position: 0 },
          { name: "Friend", position: 1 },
        ],
      },
    });
    expect(matchRes.status()).toBe(400);
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

    // The match's second Player now references alice's profile.
    const detail = await request.get(`/api/matches/${matchId}`);
    const detailBody = (await detail.json()) as {
      players: { profileId: string; profile: { alias: string } }[];
    };
    expect(
      detailBody.players.every((p) => p.profileId === alice.id),
    ).toBe(true);
    expect(
      detailBody.players.every((p) => p.profile.alias === "Alice"),
    ).toBe(true);
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

  test("POST /api/profiles/:targetId/merge folds an unclaimed source into a linked target (no token needed)", async ({
    request,
  }) => {
    // 6-C relaxation: caller owns both, source is unclaimed, target is
    // linked → merge preserves the link. The self-profile is a
    // convenient linked target (linkedUserId === viewer.id) because no
    // two-user setup is required to exercise the path.
    await createAndSignIn(request);
    const selfRes = await request.get("/api/profiles");
    const profiles = (await selfRes.json()) as ApiProfile[];
    const self = profiles.find((p) => p.linkedUserId === p.ownerId)!;

    const otherRes = await request.post("/api/profiles", {
      data: { alias: "OtherMe" },
    });
    const other = (await otherRes.json()) as ApiProfile;

    const merge = await request.post(`/api/profiles/${self.id}/merge`, {
      data: { sourceProfileId: other.id },
    });
    expect(merge.status()).toBe(200);
    const body = (await merge.json()) as { profile: ApiProfile };
    expect(body.profile.id).toBe(self.id);
    expect(body.profile.linkedUserId).toBe(self.ownerId);
  });

  test("POST /api/profiles/:targetId/merge carries linkedUserId from source to unclaimed target", async ({
    browser,
  }) => {
    // Under the single-Profile model, merging a linked source into an
    // unclaimed target preserves the link on the survivor — the caller
    // doesn't lose it just because they picked the merge direction
    // the other way around.
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const friendMe = (await (
        await friendCtx.request.get("/api/auth/get-session")
      ).json()) as { user: { id: string } };
      const friendOfOwner = await createProfile(friendCtx.request, "OwnerSide");
      const token = await mintLinkToken(friendCtx.request, friendOfOwner.id);

      await createAndSignIn(ownerCtx.request);
      const linked = await createProfile(ownerCtx.request, "Alice");
      await ownerCtx.request.post(`/api/profiles/${linked.id}/link`, {
        data: { token },
      });

      const unclaimed = await createProfile(ownerCtx.request, "AliceUnclaimed");

      const merge = await ownerCtx.request.post(
        `/api/profiles/${unclaimed.id}/merge`,
        { data: { sourceProfileId: linked.id } },
      );
      expect(merge.status()).toBe(200);
      const body = (await merge.json()) as { profile: ApiProfile };
      expect(body.profile.id).toBe(unclaimed.id);
      expect(body.profile.linkedUserId).toBe(friendMe.user.id);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
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
  test("POST /api/profiles/:id/link-token returns a token encoding caller + source profile", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const me = await (await request.get("/api/auth/get-session")).json();

    const profile = await createProfile(request, "Friend");
    const res = await request.post(
      `/api/profiles/${profile.id}/link-token`,
    );
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

    // Payload now encodes both userId and sourceProfileId.
    const [payloadB64] = body.token.split(".");
    const pad =
      payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/") + pad,
      "base64",
    ).toString("utf8");
    const payload = JSON.parse(json) as {
      userId: string;
      sourceProfileId: string;
    };
    expect(payload.userId).toBe(me.user.id);
    expect(payload.sourceProfileId).toBe(profile.id);
  });

  test("POST /api/profiles/:id/link-token rejects a non-owner and an already-linked source", async ({
    browser,
  }) => {
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    try {
      await createAndSignIn(aliceCtx.request);
      const aliceProfile = await createProfile(aliceCtx.request, "ForBob");

      // Bob can't mint a token for Alice's profile.
      await createAndSignIn(bobCtx.request);
      const otherSide = await bobCtx.request.post(
        `/api/profiles/${aliceProfile.id}/link-token`,
      );
      expect(otherSide.status()).toBe(403);

      // The caller's own self-profile is already linked → 409.
      const selfList = (await (
        await aliceCtx.request.get("/api/profiles")
      ).json()) as ApiProfile[];
      const selfProfile = selfList.find(
        (p) => p.linkedUserId === p.ownerId,
      )!;
      const onSelf = await aliceCtx.request.post(
        `/api/profiles/${selfProfile.id}/link-token`,
      );
      expect(onSelf.status()).toBe(409);
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test("POST /api/profiles/:id/link bilaterally links both profiles in one shot", async ({
    browser,
  }) => {
    // Bilateral semantics: a single scan flips linkedUserId on both
    // the scanner's target profile AND the shower's source profile.
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const friendMe = (await (
        await friendCtx.request.get("/api/auth/get-session")
      ).json()) as { user: { id: string } };
      const friendSource = await createProfile(friendCtx.request, "OwnerSide");
      const token = await mintLinkToken(friendCtx.request, friendSource.id);

      await createAndSignIn(ownerCtx.request);
      const ownerMe = (await (
        await ownerCtx.request.get("/api/auth/get-session")
      ).json()) as { user: { id: string } };
      const alice = await createProfile(ownerCtx.request, "Alice");

      const linkRes = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token } },
      );
      expect(linkRes.status()).toBe(200);
      const body = (await linkRes.json()) as {
        status: string;
        profile: ApiProfile;
        sourceProfile: ApiProfile;
      };
      expect(body.status).toBe("linked");
      // Scanner's profile now points at the shower's user…
      expect(body.profile.linkedUserId).toBe(friendMe.user.id);
      expect(body.profile.linkedUser?.id).toBe(friendMe.user.id);
      // …and the shower's profile now points at the scanner's user.
      expect(body.sourceProfile.id).toBe(friendSource.id);
      expect(body.sourceProfile.linkedUserId).toBe(ownerMe.user.id);

      // Friend's own /api/profiles confirms the source row landed.
      const friendList = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as ApiProfile[];
      const sourceAfter = friendList.find((p) => p.id === friendSource.id)!;
      expect(sourceAfter.linkedUserId).toBe(ownerMe.user.id);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("GET /api/profiles surfaces the linked friend's email after a bilateral link", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      const friend = await createAndSignIn(friendCtx.request);
      const friendSource = await createProfile(friendCtx.request, "OwnerSide");
      const token = await mintLinkToken(friendCtx.request, friendSource.id);

      await createAndSignIn(ownerCtx.request);
      const alice = await createProfile(ownerCtx.request, "Alice");

      const link = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token } },
      );
      const body = (await link.json()) as { profile: ApiProfile };
      expect(body.profile.linkedUser?.email).toBe(friend.email);

      // And the same projection comes back via the list endpoint.
      const list = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as ApiProfile[];
      const aliceAfter = list.find((p) => p.id === alice.id);
      expect(aliceAfter?.linkedUser?.email).toBe(friend.email);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("POST /api/profiles/:id/link is idempotent when both sides already point at each other", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const friendSource = await createProfile(friendCtx.request, "OwnerSide");
      const token = await mintLinkToken(friendCtx.request, friendSource.id);

      await createAndSignIn(ownerCtx.request);
      const alice = await createProfile(ownerCtx.request, "Alice");
      await ownerCtx.request.post(`/api/profiles/${alice.id}/link`, {
        data: { token },
      });

      // A replay with the same token: shower's profile is still
      // linked to scanner, scanner's profile still linked to shower
      // — must succeed, not 409.
      const replay = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token } },
      );
      expect(replay.status()).toBe(200);
      const body = (await replay.json()) as { status: string };
      expect(body.status).toBe("linked");
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("POST /api/profiles/:id/link scanner-side merge_required when caller already has another profile linked to the shower", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const friendReq = friendCtx.request;
    const ownerCtx = await browser.newContext();
    const ownerReq = ownerCtx.request;

    try {
      await createAndSignIn(friendReq);
      const friendMe = (await (
        await friendReq.get("/api/auth/get-session")
      ).json()) as { user: { id: string } };
      const friendSourceA = await createProfile(friendReq, "OwnerSideA");
      const tokenA = await mintLinkToken(friendReq, friendSourceA.id);
      const friendSourceB = await createProfile(friendReq, "OwnerSideB");
      const tokenB = await mintLinkToken(friendReq, friendSourceB.id);

      await createAndSignIn(ownerReq);
      const aleece = await createProfile(ownerReq, "Aleece");
      const alice = await createProfile(ownerReq, "Alice");

      // First link succeeds.
      const link1 = await ownerReq.post(`/api/profiles/${aleece.id}/link`, {
        data: { token: tokenA },
      });
      expect(link1.status()).toBe(200);

      // Second link to the same friend → scanner-side merge_required.
      const link2 = await ownerReq.post(`/api/profiles/${alice.id}/link`, {
        data: { token: tokenB },
      });
      expect(link2.status()).toBe(200);
      const body = (await link2.json()) as {
        status: string;
        side?: string;
        existing?: { id: string; alias: string };
        target?: { id: string; alias: string };
      };
      expect(body.status).toBe("merge_required");
      expect(body.side).toBe("scanner");
      expect(body.existing?.id).toBe(aleece.id);
      expect(body.existing?.alias).toBe("Aleece");
      expect(body.target?.id).toBe(alice.id);

      // No mutation: target stayed unclaimed.
      const profilesRes = await ownerReq.get("/api/profiles");
      const profiles = (await profilesRes.json()) as ApiProfile[];
      const aliceAfter = profiles.find((p) => p.id === alice.id)!;
      expect(aliceAfter.linkedUserId).toBeNull();

      // Caller resolves by merging Alice into Aleece — preserving
      // the friend's link on the survivor.
      const merge = await ownerReq.post(
        `/api/profiles/${aleece.id}/merge`,
        { data: { sourceProfileId: alice.id } },
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

  // The shower-side merge_required branch is a defensive guard for
  // asymmetric states (e.g. legacy unilateral data). Under the new
  // bilateral flow, the @@unique([ownerId, linkedUserId]) constraint
  // plus the bilateral semantics make it impossible to construct a
  // case where ONLY the shower has a stale profile pointing at the
  // scanner without the scanner also having the matching counterpart
  // — so the server always returns scanner-side merge_required first
  // and the shower-side branch can't be exercised through public
  // endpoints. The branch is kept for defense-in-depth against future
  // schema changes; an E2E test would require direct DB manipulation.

  test("POST /api/profiles/:id/link rejects an expired or tampered token", async ({
    request,
  }) => {
    await createAndSignIn(request);
    const alice = await createProfile(request, "Alice");

    // Malformed token
    const bad1 = await request.post(`/api/profiles/${alice.id}/link`, {
      data: { token: "not-a-token" },
    });
    expect(bad1.status()).toBe(400);

    // Forged signature on a plausible payload (now with the new
    // sourceProfileId field shape; signature still bogus).
    const fakePayload = Buffer.from(
      JSON.stringify({
        userId: "fakeid",
        sourceProfileId: "c00000000000000000000000",
        exp: Date.now() + 60_000,
      }),
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
    const own = await createProfile(request, "ForFriend");
    const token = await mintLinkToken(request, own.id);

    const profiles = (await (
      await request.get("/api/profiles")
    ).json()) as ApiProfile[];
    const self = profiles.find((p) => p.linkedUserId === p.ownerId)!;

    // Try to link another unclaimed profile owned by the same user
    // against a token they minted themselves → 400.
    const other = await createProfile(request, "Mirror");

    const res = await request.post(`/api/profiles/${other.id}/link`, {
      data: { token },
    });
    expect(res.status()).toBe(400);

    // Sanity: self-profile lookup didn't get disturbed.
    expect(self.linkedUserId).toBe(self.ownerId);
  });

  test("POST /api/profiles/:id/link forbids non-owners (scanner side)", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    const thirdCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const friendSource = await createProfile(friendCtx.request, "OwnerSide");
      const token = await mintLinkToken(friendCtx.request, friendSource.id);

      await createAndSignIn(ownerCtx.request);
      const alice = await createProfile(ownerCtx.request, "Alice");

      await createAndSignIn(thirdCtx.request);
      const res = await thirdCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token } },
      );
      expect(res.status()).toBe(403);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
      await thirdCtx.close();
    }
  });

  test("POST /api/profiles/:id/link rejects when the target is already linked to a different friend", async ({
    browser,
  }) => {
    const friendACtx = await browser.newContext();
    const friendBCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendACtx.request);
      const aSource = await createProfile(friendACtx.request, "OwnerSideA");
      const tokA = await mintLinkToken(friendACtx.request, aSource.id);

      await createAndSignIn(friendBCtx.request);
      const bSource = await createProfile(friendBCtx.request, "OwnerSideB");
      const tokB = await mintLinkToken(friendBCtx.request, bSource.id);

      await createAndSignIn(ownerCtx.request);
      const alice = await createProfile(ownerCtx.request, "Alice");

      const link1 = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token: tokA } },
      );
      expect(link1.status()).toBe(200);

      // Now Alice is linked to friend A. Linking the same profile to
      // friend B → 409.
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

  test("POST /api/profiles/:id/unlink bilaterally severs both halves (owner side)", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const friendSource = await createProfile(friendCtx.request, "OwnerSide");
      const token = await mintLinkToken(friendCtx.request, friendSource.id);

      await createAndSignIn(ownerCtx.request);
      const alice = await createProfile(ownerCtx.request, "Alice");

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

      // The counterpart on the friend's side is also cleared.
      const friendList = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as ApiProfile[];
      const friendAfter = friendList.find((p) => p.id === friendSource.id)!;
      expect(friendAfter.linkedUserId).toBeNull();
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("POST /api/profiles/:id/unlink works from the linked user's side too", async ({
    browser,
  }) => {
    // The linked friend can call /unlink on the *owner's* profile —
    // the server permits it because the friend appears in
    // target.linkedUserId. Both sides clear in one shot.
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendCtx.request);
      const friendSource = await createProfile(friendCtx.request, "OwnerSide");
      const token = await mintLinkToken(friendCtx.request, friendSource.id);

      await createAndSignIn(ownerCtx.request);
      const alice = await createProfile(ownerCtx.request, "Alice");
      const link = await ownerCtx.request.post(
        `/api/profiles/${alice.id}/link`,
        { data: { token } },
      );
      expect(link.status()).toBe(200);

      // Owner creates a match with Alice — the friend should now see it
      // through the visibility join on linkedUserId.
      const gameRes = await ownerCtx.request.get("/api/games/7-wonders-duel");
      const game = await gameRes.json();
      const ownerProfiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as ApiProfile[];
      const ownerSelf = ownerProfiles.find(
        (p) => p.linkedUserId === p.ownerId,
      )!;
      const matchRes = await ownerCtx.request.post("/api/matches", {
        data: {
          gameId: game.id,
          players: [
            { profileId: ownerSelf.id, position: 0 },
            { profileId: alice.id, position: 1 },
          ],
        },
      });
      const match = (await matchRes.json()) as { id: string };

      const friendMatchesBefore = (await (
        await friendCtx.request.get("/api/matches")
      ).json()) as { id: string }[];
      expect(friendMatchesBefore.some((m) => m.id === match.id)).toBe(true);

      // Friend unlinks the owner's Alice (acting as the linked user).
      const unlink = await friendCtx.request.post(
        `/api/profiles/${alice.id}/unlink`,
      );
      expect(unlink.status()).toBe(200);

      // Both halves clear; visibility drops on both sides.
      const ownerList = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as ApiProfile[];
      expect(ownerList.find((p) => p.id === alice.id)?.linkedUserId).toBeNull();
      const friendList = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as ApiProfile[];
      expect(
        friendList.find((p) => p.id === friendSource.id)?.linkedUserId,
      ).toBeNull();

      const friendMatchesAfter = (await (
        await friendCtx.request.get("/api/matches")
      ).json()) as { id: string }[];
      expect(friendMatchesAfter.some((m) => m.id === match.id)).toBe(false);
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
      const friendSource = await createProfile(friendCtx.request, "OwnerSide");
      const token = await mintLinkToken(friendCtx.request, friendSource.id);

      await createAndSignIn(ownerCtx.request);
      const alice = await createProfile(ownerCtx.request, "Alice");
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

  test("POST /api/profiles/:targetId/merge rejects two linked profiles pointing at different users", async ({
    browser,
  }) => {
    // The `@@unique([ownerId, linkedUserId])` constraint already
    // prevents the owner from having two profiles linked to the same
    // friend, so the only "two linked sides" scenario is two
    // different friends. Merging those would silently destroy one
    // friend's history — reject with 409.
    const friendACtx = await browser.newContext();
    const friendBCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await createAndSignIn(friendACtx.request);
      const aSource = await createProfile(friendACtx.request, "OwnerSideA");
      const tokA = await mintLinkToken(friendACtx.request, aSource.id);
      await createAndSignIn(friendBCtx.request);
      const bSource = await createProfile(friendBCtx.request, "OwnerSideB");
      const tokB = await mintLinkToken(friendBCtx.request, bSource.id);

      await createAndSignIn(ownerCtx.request);
      const alice = await createProfile(ownerCtx.request, "Alice");
      const aleece = await createProfile(ownerCtx.request, "Aleece");
      await ownerCtx.request.post(`/api/profiles/${aleece.id}/link`, {
        data: { token: tokA },
      });
      await ownerCtx.request.post(`/api/profiles/${alice.id}/link`, {
        data: { token: tokB },
      });

      const merge = await ownerCtx.request.post(
        `/api/profiles/${aleece.id}/merge`,
        { data: { sourceProfileId: alice.id } },
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

  test("POST /api/profiles/:id/link-token returns 401 without auth", async ({
    request,
  }) => {
    // Profile id doesn't matter — the auth middleware short-circuits
    // before we even check the row.
    const res = await request.post(
      "/api/profiles/c00000000000000000000000/link-token",
    );
    expect(res.status()).toBe(401);
  });
});
