import { createId } from "@paralleldrive/cuid2";
import {
  db,
  type AvatarFrame,
  type AvatarRing,
  type LocalMatch,
  type LocalPlayer,
  type LocalProfile,
  type LocalScore,
} from "./db";
import { syncEngine } from "./sync";
import {
  pullSync,
  pruneLocalMatchesAgainstServer,
  resetPullCursors,
} from "./pull-sync";

const nowIso = () => new Date().toISOString();

/** Fire-and-forget flush after every local write. Synchronous from the
 * caller's perspective: the Dexie write has already committed, and the
 * UI's `useLiveQuery` will rerender on its own. Network errors are
 * absorbed (retries handled by the sync queue). */
function scheduleFlush(): void {
  void syncEngine.flush().catch(() => {
    /* surfaced via syncQueue retries */
  });
}

export type CreateMatchInput = {
  gameId: string;
  /**
   * Per-slot resolution. Every entry must carry a `profileId`; the
   * picker (or "create new" inline flow) resolves each seat to a
   * Profile before submit. There is no longer a name-only fallback.
   */
  players: {
    profileId: string;
  }[];
  /** Pre-supplied id (tests/replay). Otherwise generated. */
  id?: string;
  metadata?: Record<string, unknown>;
};

export type CreateMatchResult = {
  matchId: string;
};

/**
 * Create a match locally. Writes a Match row, one Player row per
 * participant, an empty score set, and a single POST entry in the
 * sync queue. The returned id is a real CUID — never a draft prefix.
 *
 * Acceptance: PR A made `POST /api/matches` upsert idempotently on
 * `id`, so the queued POST is safe to replay any number of times.
 */
export async function createMatch(
  input: CreateMatchInput,
): Promise<CreateMatchResult> {
  const matchId = input.id ?? createId();
  const ts = nowIso();

  // Snapshot the local Profile rows so each Player row carries the
  // embedded `profile` projection the UI reads from. Pull-sync will
  // overwrite these snapshots with the server's canonical projection
  // on the next round-trip.
  const players: LocalPlayer[] = await Promise.all(
    input.players.map(async (p, position) => {
      const profile = await db.profiles.get(p.profileId);
      if (!profile) {
        // Should never happen — the picker only surfaces local profiles
        // and the inline-create flow writes the row before submitting.
        throw new Error(
          `createMatch: profile ${p.profileId} missing from local Dexie`,
        );
      }
      const playerProfile = {
        id: profile.id,
        ownerId: profile.ownerId,
        linkedUserId: profile.linkedUserId,
        alias: profile.alias,
        customAvatarUrl: profile.customAvatarUrl,
        useLinkedAvatar: profile.useLinkedAvatar,
        avatarFrame: profile.avatarFrame,
        avatarRing: profile.avatarRing,
        linkedUser: profile.linkedUser
          ? {
              id: profile.linkedUser.id,
              name: profile.linkedUser.name,
              alias: profile.linkedUser.alias,
              avatarUrl: profile.linkedUser.avatarUrl,
            }
          : null,
      };
      return {
        id: createId(),
        matchId,
        position,
        profileId: p.profileId,
        profileLinkedUserId: profile.linkedUserId,
        profile: playerProfile,
        updatedAt: ts,
      };
    }),
  );

  const match: LocalMatch = {
    id: matchId,
    gameId: input.gameId,
    status: "IN_PROGRESS",
    victoryType: null,
    winnerId: null,
    metadata: input.metadata ?? {},
    startedAt: ts,
    completedAt: null,
    updatedAt: ts,
  };

  await db.transaction(
    "rw",
    [db.matches, db.players, db.syncQueue],
    async () => {
      await db.matches.put(match);
      await db.players.bulkPut(players);
      await db.syncQueue.add({
        method: "POST",
        url: "/api/matches",
        body: JSON.stringify({
          id: matchId,
          gameId: input.gameId,
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
          players: players.map((p) => ({
            id: p.id,
            position: p.position,
            profileId: p.profileId,
          })),
        }),
        createdAt: ts,
        retries: 0,
        status: "pending",
      });
    },
  );

  scheduleFlush();
  return { matchId };
}

export type UpsertScoresInput = {
  matchId: string;
  scores: {
    playerId: string;
    category: string;
    value: number;
    metadata?: Record<string, unknown>;
  }[];
};

/**
 * Write one or more score rows to Dexie and enqueue a single PATCH
 * to /api/matches/:id/scores. Rows are keyed on [matchId, playerId,
 * category]; we look up any existing row to preserve its id (and
 * therefore the server-side upsert path).
 */
export async function upsertScores(input: UpsertScoresInput): Promise<void> {
  const ts = nowIso();

  await db.transaction("rw", [db.scores, db.matches, db.syncQueue], async () => {
    const toPut: LocalScore[] = [];
    for (const s of input.scores) {
      const existing = await db.scores
        .where("[matchId+playerId+category]")
        .equals([input.matchId, s.playerId, s.category])
        .first();
      toPut.push({
        id: existing?.id ?? createId(),
        matchId: input.matchId,
        playerId: s.playerId,
        category: s.category,
        value: s.value,
        metadata: s.metadata ?? {},
        updatedAt: ts,
      });
    }
    await db.scores.bulkPut(toPut);
    await touchMatchUpdatedAt(input.matchId, ts);

    await db.syncQueue.add({
      method: "PATCH",
      url: `/api/matches/${input.matchId}/scores`,
      body: JSON.stringify({
        scores: input.scores.map((s) => ({
          playerId: s.playerId,
          category: s.category,
          value: s.value,
          ...(s.metadata !== undefined ? { metadata: s.metadata } : {}),
        })),
      }),
      createdAt: ts,
      retries: 0,
      status: "pending",
    });
  });

  scheduleFlush();
}

export type PatchMatchInput = {
  matchId: string;
  metadata?: Record<string, unknown>;
  playerOrder?: { playerId: string; position: number }[];
};

/**
 * Edit match metadata or reorder players. Mirrors PATCH /api/matches/:id.
 * The server rejects PATCH on a COMPLETED match — we don't pre-check
 * locally (we trust the UI not to expose those affordances) and let
 * the queued PATCH 400 if a stale UI somehow fires one; it'll go to
 * `status: "failed"` in the queue rather than retry forever.
 */
export async function patchMatch(input: PatchMatchInput): Promise<void> {
  const ts = nowIso();

  await db.transaction(
    "rw",
    [db.matches, db.players, db.syncQueue],
    async () => {
      const match = await db.matches.get(input.matchId);
      if (match) {
        const next: LocalMatch = {
          ...match,
          ...(input.metadata !== undefined
            ? { metadata: input.metadata }
            : {}),
          updatedAt: ts,
        };
        await db.matches.put(next);
      } else {
        warnMissingLocalMatch("patchMatch", input.matchId);
      }

      if (input.playerOrder) {
        for (const entry of input.playerOrder) {
          await db.players.update(entry.playerId, {
            position: entry.position,
            updatedAt: ts,
          });
        }
      }

      await db.syncQueue.add({
        method: "PATCH",
        url: `/api/matches/${input.matchId}`,
        body: JSON.stringify({
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
          ...(input.playerOrder ? { playerOrder: input.playerOrder } : {}),
        }),
        createdAt: ts,
        retries: 0,
        status: "pending",
      });
    },
  );

  scheduleFlush();
}

export type CompleteMatchInput = {
  matchId: string;
  victoryType: string;
  winnerId: string | null;
};

/**
 * Mark a match COMPLETED. Mirrors PUT /api/matches/:id with a status
 * transition. Locally writes the new status + outcome fields and
 * `completedAt`, then enqueues the PUT.
 */
export async function completeMatch(input: CompleteMatchInput): Promise<void> {
  const ts = nowIso();

  await db.transaction("rw", [db.matches, db.syncQueue], async () => {
    const match = await db.matches.get(input.matchId);
    if (match) {
      const next: LocalMatch = {
        ...match,
        status: "COMPLETED",
        victoryType: input.victoryType,
        winnerId: input.winnerId,
        completedAt: ts,
        updatedAt: ts,
      };
      await db.matches.put(next);
    } else {
      warnMissingLocalMatch("completeMatch", input.matchId);
    }

    await db.syncQueue.add({
      method: "PUT",
      url: `/api/matches/${input.matchId}`,
      body: JSON.stringify({
        status: "COMPLETED",
        victoryType: input.victoryType,
        winnerId: input.winnerId,
      }),
      createdAt: ts,
      retries: 0,
      status: "pending",
    });
  });

  scheduleFlush();
}

async function touchMatchUpdatedAt(matchId: string, ts: string): Promise<void> {
  const match = await db.matches.get(matchId);
  if (match) {
    await db.matches.update(matchId, { updatedAt: ts });
  } else {
    warnMissingLocalMatch("touchMatchUpdatedAt", matchId);
  }
}

/** Surface — without throwing — the rare case where a mutation runs for
 * a match that isn't mirrored locally. Either pullSync hasn't caught up,
 * the user navigated to a server-only match in a way the data hooks
 * shouldn't allow, or Dexie was wiped mid-session. The queued network
 * request still fires (server is authoritative), but a stale local view
 * would be the only symptom — worth a log. */
function warnMissingLocalMatch(op: string, matchId: string): void {
  console.warn(
    `[mutations.${op}] match ${matchId} not found in Dexie; ` +
      `queueing server request without local mirror update.`,
  );
}

// ─── Profile mutations (Phase 6-A) ───

export type CreateProfileInput = {
  /** The User who will own the new profile. Caller passes their own
   * id from the session. The server enforces this server-side from the
   * authenticated cookie; the client copy is only used to populate the
   * local Dexie row so it appears in suggestions before the POST has
   * even hit the wire. */
  ownerId: string;
  alias: string;
  /** Optional pre-supplied id — used by tests and by inline profile
   * creation from the new-match form so the resulting Player row can
   * reference it immediately. */
  id?: string;
};

export type CreateProfileResult = {
  profileId: string;
};

/**
 * Create an unclaimed Profile locally and enqueue a POST to /api/profiles.
 * The id is generated client-side; the server upserts idempotently on it.
 *
 * Owner-only visibility is enforced by the server's `profileVisibilityWhere`
 * filter; the local row is written eagerly so `useProfileList()` rerenders
 * before the network request resolves.
 */
export async function createProfile(
  input: CreateProfileInput,
): Promise<CreateProfileResult> {
  const profileId = input.id ?? createId();
  const alias = input.alias.trim();
  const ts = nowIso();

  const profile: LocalProfile = {
    id: profileId,
    ownerId: input.ownerId,
    linkedUserId: null,
    alias,
    customAvatarUrl: null,
    useLinkedAvatar: true,
    avatarFrame: "circle",
    avatarRing: null,
    usedAt: ts,
    createdAt: ts,
    updatedAt: ts,
    linkedUser: null,
  };

  await db.transaction("rw", [db.profiles, db.syncQueue], async () => {
    await db.profiles.put(profile);
    await db.syncQueue.add({
      method: "POST",
      url: "/api/profiles",
      body: JSON.stringify({ id: profileId, alias }),
      createdAt: ts,
      retries: 0,
      status: "pending",
    });
  });

  scheduleFlush();
  return { profileId };
}

/**
 * Upload an avatar image for a Profile. Bypasses the sync queue (the
 * request body is binary; queue entries are JSON) and uploads
 * synchronously — if offline, the call rejects and the caller surfaces
 * an error rather than queuing the binary for later. On success the
 * server returns the updated Profile row; we mirror it into Dexie so
 * the UI updates without waiting for the next pullSync.
 */
export async function uploadAvatar(input: {
  profileId: string;
  file: Blob;
}): Promise<void> {
  if (!navigator.onLine) {
    throw new Error("Avatar uploads require an online connection");
  }
  const form = new FormData();
  form.append("avatar", input.file);

  const res = await fetch(`/api/profiles/${input.profileId}/avatar`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Upload failed (${res.status})`);
  }
  const updated = (await res.json()) as LocalProfile;
  await db.profiles.put(updated);
  await refreshLocalPlayerProjections(updated);
}

/**
 * Clear the owner-uploaded avatar. Deletes the server-side files and
 * resets `customAvatarUrl` + `useLinkedAvatar` to defaults; we mirror
 * the response into Dexie so the UI flips back to the initial-letter
 * or linked-photo fallback immediately.
 */
export async function clearCustomAvatar(input: {
  profileId: string;
}): Promise<void> {
  if (!navigator.onLine) {
    throw new Error("Avatar removal requires an online connection");
  }
  const res = await fetch(`/api/profiles/${input.profileId}/avatar`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Delete failed (${res.status})`);
  }
  const updated = (await res.json()) as LocalProfile;
  await db.profiles.put(updated);
  await refreshLocalPlayerProjections(updated);
}

/**
 * Rewrite every local Player row's embedded `profile` snapshot for the
 * supplied profile so the UI reflects custom-avatar / frame / ring /
 * alias changes immediately, before the next pull-sync delta arrives.
 *
 * Without this, the writer device sees stale data on every screen that
 * reads through `Player.profile` (match history, scorers, banners),
 * because the canonical projection lives on Match rows that pull-sync
 * only refreshes when their `updatedAt` bumps server-side.
 */
async function refreshLocalPlayerProjections(
  profile: LocalProfile,
): Promise<void> {
  const players = await db.players
    .where("profileId")
    .equals(profile.id)
    .toArray();
  if (players.length === 0) return;
  const projection = {
    id: profile.id,
    ownerId: profile.ownerId,
    linkedUserId: profile.linkedUserId,
    alias: profile.alias,
    customAvatarUrl: profile.customAvatarUrl,
    useLinkedAvatar: profile.useLinkedAvatar,
    avatarFrame: profile.avatarFrame,
    avatarRing: profile.avatarRing,
    linkedUser: profile.linkedUser
      ? {
          id: profile.linkedUser.id,
          name: profile.linkedUser.name,
          alias: profile.linkedUser.alias,
          avatarUrl: profile.linkedUser.avatarUrl,
        }
      : null,
  };
  for (const p of players) {
    p.profile = projection;
    p.profileLinkedUserId = profile.linkedUserId;
  }
  await db.players.bulkPut(players);
}

/**
 * Collapse `sourceProfileId` into `targetProfileId`. Optimistically
 * rewrites Dexie's Player rows + deletes the source Profile before
 * the POST returns so the UI updates immediately, then queues the
 * POST so an offline merge replays on reconnect.
 *
 * Under the single-Profile model (6-C) a merge is always an
 * owner-side consolidation of two profiles the caller owns. The
 * server preserves any `linkedUserId` from the source onto the
 * surviving target when the target lacks one.
 */
export async function mergeProfile(input: {
  targetProfileId: string;
  sourceProfileId: string;
}): Promise<void> {
  const ts = nowIso();
  const target = await db.profiles.get(input.targetProfileId);

  await db.transaction(
    "rw",
    [db.profiles, db.players, db.syncQueue],
    async () => {
      // Rewrite every local Player from source → target so the UI
      // flips immediately. The embedded `profile` projection on each
      // row gets refreshed by the next pullSync.
      const players = await db.players
        .where("profileId")
        .equals(input.sourceProfileId)
        .toArray();
      if (players.length > 0 && target) {
        const targetProjection = {
          id: target.id,
          ownerId: target.ownerId,
          linkedUserId: target.linkedUserId,
          alias: target.alias,
          customAvatarUrl: target.customAvatarUrl,
          useLinkedAvatar: target.useLinkedAvatar,
          avatarFrame: target.avatarFrame,
          avatarRing: target.avatarRing,
          linkedUser: target.linkedUser
            ? {
                id: target.linkedUser.id,
                name: target.linkedUser.name,
                alias: target.linkedUser.alias,
                avatarUrl: target.linkedUser.avatarUrl,
              }
            : null,
        };
        for (const p of players) {
          p.profileId = input.targetProfileId;
          p.profileLinkedUserId = target.linkedUserId;
          p.profile = targetProjection;
          p.updatedAt = ts;
        }
        await db.players.bulkPut(players);
      }

      await db.profiles.delete(input.sourceProfileId);

      await db.syncQueue.add({
        method: "POST",
        url: `/api/profiles/${input.targetProfileId}/merge`,
        body: JSON.stringify({ sourceProfileId: input.sourceProfileId }),
        createdAt: ts,
        retries: 0,
        status: "pending",
      });
    },
  );

  scheduleFlush();
}

// ─── Profile link / unlink (Phase 6-C) ───
//
// The link flow can't ride the offline sync queue: tokens expire after
// 60s, so a queued request that fires after a reconnect would always
// fail verification. These mutations therefore POST directly and
// surface network errors to the caller, which renders them inline in
// the link UI ("token expired — ask your friend to refresh the QR").

export type LinkTokenResponse = {
  token: string;
  expiresAt: string;
};

/**
 * Ask the server to mint a short-lived signed token anchored on the
 * caller's owned profile `sourceProfileId`. The friend's app scans
 * this and POSTs it to their own owned profile — the link is bilateral
 * by construction. The caller's User id is read from the session, so
 * the only parameter is the source profile id.
 */
export async function requestLinkToken(input: {
  sourceProfileId: string;
}): Promise<LinkTokenResponse> {
  if (!navigator.onLine) {
    throw new Error("A network connection is required to show a link code");
  }
  const res = await fetch(
    `/api/profiles/${input.sourceProfileId}/link-token`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!res.ok) {
    throw new Error(`Could not mint link token (${res.status})`);
  }
  return (await res.json()) as LinkTokenResponse;
}

/**
 * Bilaterally link two unclaimed Profiles representing the same person:
 * `profileId` (the scanner's owned profile) and the token-embedded
 * `sourceProfileId` (the shower's owned profile). On the happy path,
 * the server returns both updated rows in one shot and we mirror both
 * into Dexie so the scanner's Players tab + the shower's own profile
 * (if they're on this device) flip to linked without a pull-sync.
 *
 * Two merge-required branches surface:
 *  - `side: "scanner"` → the caller already has another profile linked
 *    to the shower; UI prompts to merge.
 *  - `side: "shower"` → the shower already has another profile linked
 *    to the caller; UI surfaces a non-actionable message and the
 *    caller asks their friend to merge first.
 */
export type LinkProfileResponse =
  | {
      status: "linked";
      profile: LocalProfile;
      sourceProfile: LocalProfile;
    }
  | {
      status: "merge_required";
      side: "scanner";
      existing: { id: string; alias: string };
      target: { id: string; alias: string };
    }
  | {
      status: "merge_required";
      side: "shower";
      existingAlias: string;
      targetAlias: string;
    };

export async function linkProfile(input: {
  profileId: string;
  token: string;
}): Promise<LinkProfileResponse> {
  if (!navigator.onLine) {
    throw new Error("A network connection is required to link a profile");
  }
  const res = await fetch(`/api/profiles/${input.profileId}/link`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: input.token }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Link failed (${res.status})`);
  }
  const body = (await res.json()) as LinkProfileResponse;
  if (body.status === "linked") {
    // Mirror both authoritative rows immediately so the local Dexie
    // matches the server. The shower's `sourceProfile` may or may not
    // exist locally (it does if the shower is the same user on this
    // device, e.g. two browser profiles); putting it is a no-op when
    // the row isn't reachable through other queries.
    await db.profiles.put(body.profile);
    await db.profiles.put(body.sourceProfile);
    // The link retroactively makes the friend's pre-link matches +
    // their owned-friend profiles visible to us, but linking doesn't
    // bump `Match.updatedAt` server-side, so a `?since=` delta would
    // miss them entirely. Drop the pull cursors and do one full pull
    // so the friend's pre-link history lands in local Dexie.
    await resetPullCursors();
    try {
      await pullSync({ force: true });
    } catch {
      // Network blip — the next routine pullSync (boot / route /
      // online event) will retry with the now-cleared cursor.
    }
  }
  return body;
}

/**
 * Bilaterally sever a link. The server clears `linkedUserId` on both
 * `:id` and the counterpart profile (the other side of the bilateral
 * pair) in one transaction; we mirror both into Dexie so the local
 * Players tab reflects the change without waiting for the next
 * pull-sync. Either the owner or the linked user can call this; the
 * server enforces that authorization. Self-Profiles cannot be
 * unlinked — the server returns 409.
 *
 * Matches that were only visible via the now-broken bilateral link
 * are pruned from local Dexie afterwards — the incremental `?since=`
 * pull cannot represent deletions.
 */
export async function unlinkProfile(input: {
  profileId: string;
  /** True when the *linked friend* (not the owner) is the one calling.
   * Used to delete the local mirror on success, since the profile is
   * about to drop out of the caller's `/api/profiles` response. */
  asLinkedUser?: boolean;
}): Promise<void> {
  if (!navigator.onLine) {
    throw new Error("A network connection is required to unlink a profile");
  }
  const res = await fetch(`/api/profiles/${input.profileId}/unlink`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Unlink failed (${res.status})`);
  }
  const updated = (await res.json()) as LocalProfile;
  if (input.asLinkedUser) {
    await db.profiles.delete(input.profileId);
  } else {
    await db.profiles.put(updated);
  }

  // The counterpart profile (the other half of the bilateral link)
  // is owned by the friend, so it never appears in our own
  // `/api/profiles` response. There is therefore nothing to mirror
  // locally — pruning matches below covers the visibility side. The
  // friend's own device will pick up the unlink on its next
  // `/api/profiles` pull.
  await pruneLocalMatchesAgainstServer();
}

export type PatchProfileInput = {
  profileId: string;
  alias?: string;
  useLinkedAvatar?: boolean;
  /** Stamp frame shape (Phase 7). Pass to update; omit to leave alone. */
  avatarFrame?: AvatarFrame;
  /** Stamp colour ring (Phase 7). Pass `null` to clear, omit to leave alone. */
  avatarRing?: AvatarRing;
};

type PatchProfileBody = {
  alias?: string;
  useLinkedAvatar?: boolean;
  avatarFrame?: AvatarFrame;
  avatarRing?: AvatarRing;
};

/**
 * Edit a Profile's owner-controlled fields. Optimistically applies the
 * patch to Dexie and enqueues a PATCH /api/profiles/:id. All fields are
 * optional; passing none is a no-op (the server would reject it).
 */
export async function patchProfile(input: PatchProfileInput): Promise<void> {
  const ts = nowIso();
  const body: PatchProfileBody = {};
  if (input.alias !== undefined) body.alias = input.alias.trim();
  if (input.useLinkedAvatar !== undefined)
    body.useLinkedAvatar = input.useLinkedAvatar;
  if (input.avatarFrame !== undefined) body.avatarFrame = input.avatarFrame;
  // `avatarRing: null` is a valid edit (clears the ring), so we must
  // distinguish it from "omitted". `hasOwnProperty` is the unambiguous
  // signal; `=== undefined` would also be false for explicit null but
  // this form documents intent.
  if (Object.prototype.hasOwnProperty.call(input, "avatarRing")) {
    body.avatarRing = input.avatarRing ?? null;
  }

  if (Object.keys(body).length === 0) return;

  let refreshedProfile: LocalProfile | null = null;
  await db.transaction(
    "rw",
    [db.profiles, db.players, db.syncQueue],
    async () => {
      const profile = await db.profiles.get(input.profileId);
      if (profile) {
        const next: LocalProfile = {
          ...profile,
          ...(body.alias !== undefined ? { alias: body.alias } : {}),
          ...(body.useLinkedAvatar !== undefined
            ? { useLinkedAvatar: body.useLinkedAvatar }
            : {}),
          ...(body.avatarFrame !== undefined
            ? { avatarFrame: body.avatarFrame }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(body, "avatarRing")
            ? { avatarRing: body.avatarRing ?? null }
            : {}),
          updatedAt: ts,
        };
        await db.profiles.put(next);
        refreshedProfile = next;
      } else {
        console.warn(
          `[mutations.patchProfile] profile ${input.profileId} not found in Dexie; ` +
            `queueing server request without local mirror update.`,
        );
      }

      await db.syncQueue.add({
        method: "PATCH",
        url: `/api/profiles/${input.profileId}`,
        body: JSON.stringify(body),
        createdAt: ts,
        retries: 0,
        status: "pending",
      });
    },
  );

  // Refresh embedded Player.profile snapshots so the writer device
  // sees the new alias / frame / ring / useLinkedAvatar immediately on
  // every match-history and scoring surface, instead of waiting for
  // the next pull-sync delta to arrive.
  if (refreshedProfile) {
    await refreshLocalPlayerProjections(refreshedProfile);
  }

  scheduleFlush();
}
