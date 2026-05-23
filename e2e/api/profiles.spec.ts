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
});
