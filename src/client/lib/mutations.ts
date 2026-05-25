import { createId } from "@paralleldrive/cuid2";
import {
  db,
  type LocalMatch,
  type LocalPlayer,
  type LocalProfile3,
  type LocalScore,
} from "./db";
import { syncEngine } from "./sync";

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
   * Per-slot resolution. As of PR 6-B every entry should carry a
   * `profileId` — the picker either selected an existing profile or
   * created one inline before submit. `name` + `userId` remain for the
   * narrow rematch path that hits a pre-6-A Dexie row whose profileId
   * is still null; on submit the server falls back to the legacy
   * name-resolver for that single slot.
   */
  players: {
    profileId?: string | null;
    name?: string;
    userId?: string | null;
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

  // Hydrate each slot to the row we want to mirror locally. The picker
  // passes `profileId`; legacy callers (rematch from pre-6-A rows) still
  // pass `name`. We look up the local Profile to snapshot its alias into
  // `Player.name` so the UI has something to render even before the
  // server response comes back.
  const players: LocalPlayer[] = await Promise.all(
    input.players.map(async (p, position) => {
      let name = p.name ?? "";
      if (p.profileId) {
        const profile = await db.profiles.get(p.profileId);
        if (profile) name = profile.alias;
      }
      return {
        id: createId(),
        matchId,
        name,
        position,
        userId: p.userId ?? null,
        profileId: p.profileId ?? null,
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
            ...(p.profileId
              ? { profileId: p.profileId }
              : { name: p.name }),
            ...(p.userId ? { userId: p.userId } : {}),
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

  const profile: LocalProfile3 = {
    id: profileId,
    ownerId: input.ownerId,
    linkedUserId: null,
    alias,
    customAvatarUrl: null,
    useLinkedAvatar: true,
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
  const updated = (await res.json()) as LocalProfile3;
  await db.profiles.put(updated);
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
  const updated = (await res.json()) as LocalProfile3;
  await db.profiles.put(updated);
}

/**
 * Collapse `sourceProfileId` into `targetProfileId` for the unclaimed
 * variant (6-B). Optimistically rewrites Dexie's Player rows + deletes
 * the source Profile before the POST returns so the UI updates
 * immediately, then queues the POST so an offline merge replays on
 * reconnect.
 *
 * The 6-B server endpoint rejects linked profiles outright; we don't
 * pre-check here because the UI surface (MergeDialog) only shows
 * unclaimed candidates. A server rejection therefore implies a sync
 * race (target became linked between dialog render and submit) — the
 * queued POST flips to `failed` and the user can retry from a fresh
 * dialog.
 */
export async function mergeProfile(input: {
  targetProfileId: string;
  sourceProfileId: string;
  /**
   * Link-time merge token: required by the server when either profile
   * is linked. The standalone (unclaimed) merge path leaves it
   * undefined and the server rejects linked profiles outright.
   * Caller obtains the token via {@link requestLinkToken} executed by
   * the friend's session (or, in the link-collision branch, by
   * forwarding the very same token the friend already minted for the
   * link attempt).
   */
  token?: string;
}): Promise<void> {
  const ts = nowIso();
  const target = await db.profiles.get(input.targetProfileId);
  const survivingAlias = target?.alias ?? "";

  await db.transaction(
    "rw",
    [db.profiles, db.players, db.syncQueue],
    async () => {
      // Rewrite every local Player from source → target. We carry the
      // surviving alias forward into the legacy `name` column so the
      // dormant value matches what the server is about to snapshot.
      const players = await db.players
        .where("profileId")
        .equals(input.sourceProfileId)
        .toArray();
      for (const p of players) {
        p.profileId = input.targetProfileId;
        if (survivingAlias) p.name = survivingAlias;
        p.updatedAt = ts;
      }
      if (players.length > 0) {
        await db.players.bulkPut(players);
      }

      await db.profiles.delete(input.sourceProfileId);

      await db.syncQueue.add({
        method: "POST",
        url: `/api/profiles/${input.targetProfileId}/merge`,
        body: JSON.stringify({
          sourceProfileId: input.sourceProfileId,
          ...(input.token ? { token: input.token } : {}),
        }),
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
 * Ask the server to mint a short-lived signed token attesting that the
 * caller is themselves. The friend will scan this and POST it to bind
 * one of their local profiles to the caller's auth User. The server
 * pulls the User id from the session — there is no parameter.
 */
export async function requestLinkToken(): Promise<LinkTokenResponse> {
  if (!navigator.onLine) {
    throw new Error("A network connection is required to show a link code");
  }
  const res = await fetch("/api/profiles/link-token", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Could not mint link token (${res.status})`);
  }
  return (await res.json()) as LinkTokenResponse;
}

/**
 * Bind an owned, unclaimed Profile to the friend's auth User. Returns
 * either `{ status: "linked", profile }` (happy path — server updated
 * the row) or `{ status: "merge_required", existing, target }` when
 * the owner already has another Profile linked to the same friend.
 *
 * The caller's UI handles the `merge_required` branch by confirming
 * the merge with the user and calling {@link mergeProfile} with the
 * same token (the server re-verifies it).
 */
export type LinkProfileResponse =
  | { status: "linked"; profile: LocalProfile3 }
  | {
      status: "merge_required";
      existing: { id: string; alias: string };
      target: { id: string; alias: string };
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
  const body = (await res.json()) as
    | { status: "linked"; profile: LocalProfile3 }
    | LinkProfileResponse;
  if (body.status === "linked") {
    // Mirror the server's authoritative row immediately so the
    // Players tab flips from "unclaimed" → "linked" without waiting
    // for the next pullSync.
    await db.profiles.put(body.profile);
  }
  return body;
}

/**
 * Sever the link between a Profile and an auth User. Either the owner
 * or the linked user can call this. Self-Profiles cannot be unlinked
 * — the server enforces that and returns 409.
 *
 * On success we mirror the updated row into Dexie so the UI flips
 * back to the unclaimed badge immediately. When the linked user
 * unlinks themself, the Profile drops out of their visibility filter
 * server-side; we also delete it locally so it disappears from the
 * Players tab without waiting for a full pullSync.
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
  const updated = (await res.json()) as LocalProfile3;
  if (input.asLinkedUser) {
    await db.profiles.delete(input.profileId);
  } else {
    await db.profiles.put(updated);
  }

  // Matches that were only visible via the now-unlinked profile
  // need to drop out of the local mirror too — the incremental
  // `?since=` pull can't represent deletions, so they would
  // otherwise linger forever. Authoritative source: re-fetch the
  // full match list (post-unlink the server already applies the
  // narrowed visibility filter) and prune any local match whose
  // id is missing from the response, excluding matches that are
  // still pending a POST in the sync queue.
  await pruneLocalMatchesAgainstServer();
}

async function pruneLocalMatchesAgainstServer(): Promise<void> {
  if (!navigator.onLine) return;
  let visibleIds: Set<string>;
  try {
    const res = await fetch("/api/matches", { credentials: "include" });
    if (!res.ok) return;
    const list = (await res.json()) as { id: string }[];
    visibleIds = new Set(list.map((m) => m.id));
  } catch {
    return;
  }

  // Anything queued for POST hasn't reached the server yet — if we
  // pruned it, the next flush would re-create it but the local
  // state would have flickered to empty in between. The queue
  // entries store the path; the match id sits inside the JSON
  // body.
  const queued = await db.syncQueue.toArray();
  const queuedIds = new Set<string>();
  for (const entry of queued) {
    if (
      entry.url === "/api/matches" &&
      entry.method === "POST" &&
      entry.body
    ) {
      try {
        const body = JSON.parse(entry.body) as { id?: string };
        if (body.id) queuedIds.add(body.id);
      } catch {
        // Malformed queue entry — skip; the queue runner will
        // surface the failure separately.
      }
    }
  }

  const localIds = (await db.matches.toCollection().primaryKeys()) as string[];
  const stale = localIds.filter(
    (id) => !visibleIds.has(id) && !queuedIds.has(id),
  );
  if (stale.length === 0) return;

  await db.transaction(
    "rw",
    [db.matches, db.players, db.scores],
    async () => {
      await db.players.where("matchId").anyOf(stale).delete();
      await db.scores.where("matchId").anyOf(stale).delete();
      await db.matches.bulkDelete(stale);
    },
  );
}

export type PatchProfileInput = {
  profileId: string;
  alias?: string;
  useLinkedAvatar?: boolean;
};

/**
 * Edit a Profile's owner-controlled fields. Optimistically applies the
 * patch to Dexie and enqueues a PATCH /api/profiles/:id. Both fields are
 * optional; passing neither is a no-op (the server would reject it).
 */
export async function patchProfile(input: PatchProfileInput): Promise<void> {
  const ts = nowIso();
  const body: { alias?: string; useLinkedAvatar?: boolean } = {};
  if (input.alias !== undefined) body.alias = input.alias.trim();
  if (input.useLinkedAvatar !== undefined)
    body.useLinkedAvatar = input.useLinkedAvatar;

  if (Object.keys(body).length === 0) return;

  await db.transaction("rw", [db.profiles, db.syncQueue], async () => {
    const profile = await db.profiles.get(input.profileId);
    if (profile) {
      const next: LocalProfile3 = {
        ...profile,
        ...(body.alias !== undefined ? { alias: body.alias } : {}),
        ...(body.useLinkedAvatar !== undefined
          ? { useLinkedAvatar: body.useLinkedAvatar }
          : {}),
        updatedAt: ts,
      };
      await db.profiles.put(next);
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
  });

  scheduleFlush();
}
