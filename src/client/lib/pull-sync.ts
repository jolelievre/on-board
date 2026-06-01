import { api } from "./api";
import type { ApiGame, ApiMatch, ApiProfile } from "./api-types";
import {
  db,
  type LocalGame,
  type LocalMatch,
  type LocalPlayer,
  type LocalProfile,
  type LocalScore,
} from "./db";
import { resolveSelfAlias } from "../../shared/players";

const SYNC_META_LAST_PULL = "lastPullAt";
const SYNC_META_LAST_PROFILE_PULL = "lastProfilePullAt";

/** Minimum interval between successive `pullSync()` attempts (forceable
 * via `{ force: true }`). Without throttling, the post-flush pullSync
 * chained off every mutation would re-fetch `/api/games` and
 * `/api/matches?since=` on every score input — observable as a wave of
 * duplicate GETs in the network tab. 5 s is short enough that cross-
 * device freshness stays reasonable, long enough that rapid in-app
 * mutations don't spam the server. Explicit triggers (initial mount,
 * tab regain via `visibilitychange`) bypass the throttle with `force`. */
const MIN_PULL_INTERVAL_MS = 5_000;

/** Module-scoped timestamp of the most recent `pullSync()` invocation.
 * Resets on page reload along with the rest of the JS module state;
 * the boot-time `pullSync({ force: true })` in `_authenticated.tsx`
 * fills the post-reload cold cache regardless. */
let lastPullStartedAt = 0;

/** Patch the cached Profile rows for the self-Profile and any profile
 * the given user is the linked target of, after a Settings alias edit.
 *
 * Under the single-Profile model, the Player row carries the embedded
 * Profile projection — so when a Profile's `linkedUser.alias` changes,
 * the Player rows that reference that Profile already see the new
 * value on the next pull-sync (the server re-projects from the live
 * join). We only need to refresh the Profile rows themselves locally
 * so the Settings flip is visible without waiting for the next pull.
 *
 * Alias edits don't bump `Match.updatedAt` on the server (they only
 * touch the User row), so a subsequent `pullSync()` would LWW-skip
 * every match and leave Dexie's player projection stale. We force a
 * full match re-pull in Settings after this function returns to
 * refresh the embedded `profile.linkedUser.alias` snapshots.
 */
export async function refreshLocalAliases(
  userId: string,
  newAlias: string | null,
): Promise<void> {
  const ts = new Date().toISOString();
  const linkedProfiles = await db.profiles
    .where("linkedUserId")
    .equals(userId)
    .toArray();
  if (linkedProfiles.length === 0) return;

  for (const profile of linkedProfiles) {
    if (profile.linkedUser) {
      profile.linkedUser = {
        ...profile.linkedUser,
        alias: newAlias,
      };
    }
    if (profile.ownerId === userId) {
      profile.alias = resolveSelfAlias({
        name: profile.linkedUser?.name ?? "",
        alias: newAlias,
      });
    }
    profile.updatedAt = ts;
  }
  await db.profiles.bulkPut(linkedProfiles);
}

/** Read a key from the singleton syncMeta keystore. */
export async function getSyncMeta(key: string): Promise<string | undefined> {
  const row = await db.syncMeta.get(key);
  return row?.value;
}

/** Upsert a key into the singleton syncMeta keystore. */
export async function setSyncMeta(key: string, value: string): Promise<void> {
  await db.syncMeta.put({ key, value });
}

/**
 * Drop both pull cursors so the next `pullSync()` re-fetches every
 * server-visible match + profile without a `?since=` filter. Used when
 * a server-side visibility change can retroactively make older rows
 * visible (the bilateral link flow is the canonical case: linking
 * doesn't bump `Match.updatedAt`, so a `?since=` delta would miss the
 * friend's pre-link history entirely).
 */
export async function resetPullCursors(): Promise<void> {
  await db.syncMeta.bulkDelete([
    SYNC_META_LAST_PULL,
    SYNC_META_LAST_PROFILE_PULL,
  ]);
}

/**
 * Pull updates from the server into Dexie. Idempotent. Safe to call from
 * multiple triggers: app boot, post-flush, `online` event, route change,
 * tab regain (`visibilitychange`).
 *
 * - Always re-pulls the games catalogue (small, rarely changes).
 * - Pulls matches since the last successful pull cursor; falls back to a
 *   full pull on first call. Per-row Last-Write-Wins on `updatedAt`.
 * - Throttled to `MIN_PULL_INTERVAL_MS` between attempts. Pass
 *   `{ force: true }` to bypass — used by initial mount and tab-regain
 *   triggers where freshness matters more than dedup.
 *
 * Network failures are surfaced as thrown errors so callers can decide
 * whether to log/ignore; offline calls short-circuit silently.
 */
export async function pullSync(
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  if (!navigator.onLine) return;

  const now = Date.now();
  if (!force && now - lastPullStartedAt < MIN_PULL_INTERVAL_MS) return;
  lastPullStartedAt = now;

  const since = await getSyncMeta(SYNC_META_LAST_PULL);
  const sinceProfiles = await getSyncMeta(SYNC_META_LAST_PROFILE_PULL);
  const pulledAt = new Date().toISOString();

  const matchesUrl = since
    ? `/api/matches?since=${encodeURIComponent(since)}`
    : `/api/matches`;
  const profilesUrl = sinceProfiles
    ? `/api/profiles?since=${encodeURIComponent(sinceProfiles)}`
    : `/api/profiles`;

  // Each endpoint runs as an independent fetch → transaction pipeline.
  // Earlier iterations coordinated all three with `Promise.all` /
  // `allSettled`, but if any single fetch hangs (e.g. `setOffline(true)`
  // dropping an in-flight request without rejecting it), the join would
  // hang too — and the writes for the requests that DID return would
  // never reach Dexie. Independent pipelines make each entity's
  // freshness depend only on its own fetch returning. The outer
  // `allSettled` only governs when the *caller's* await resolves; the
  // Dexie writes already fired as each fetch landed.
  const games = pullEntity(
    api<ApiGame[]>("/api/games"),
    async (rows) => {
      await db.transaction("rw", db.games, async () => {
        await mergeGames(rows);
      });
    },
  );
  const matches = pullEntity(
    api<ApiMatch[]>(matchesUrl),
    async (rows) => {
      await db.transaction(
        "rw",
        [db.matches, db.players, db.scores, db.syncMeta],
        async () => {
          await mergeMatches(rows);
          await setSyncMeta(SYNC_META_LAST_PULL, pulledAt);
        },
      );
    },
  );
  // Track whether any owned profile transitioned from unclaimed to
  // linked during this pull. That's the shower-side signal for a
  // bilateral link that just landed (the scanner's `linkProfile`
  // mutation has its own eager reset+pull, but the shower has no
  // direct hook unless their `LinkCodeDisplay` polling is active).
  // When detected we clear the matches cursor and re-pull at the end
  // — the friend's pre-link history doesn't carry a fresh
  // `Match.updatedAt`, so the `?since=` delta above would miss it.
  //
  // Symmetric case: a previously-linked owned profile may have lost
  // its `linkedUserId` because the friend unlinked from their device.
  // The matches that were only visible via that link drop out of the
  // server's visibility filter, but the `?since=` cursor can't
  // represent deletions — so we run a full prune after the merge.
  let linkTransitionDetected = false;
  let unlinkTransitionDetected = false;
  const profiles = pullEntity(
    api<ApiProfile[]>(profilesUrl),
    async (rows) => {
      await db.transaction(
        "rw",
        [db.profiles, db.syncMeta],
        async () => {
          const transitions = await mergeProfiles(rows);
          if (transitions.link) linkTransitionDetected = true;
          if (transitions.unlink) unlinkTransitionDetected = true;
          await setSyncMeta(SYNC_META_LAST_PROFILE_PULL, pulledAt);
        },
      );
    },
  );

  await Promise.allSettled([games, matches, profiles]);

  if (linkTransitionDetected) {
    await resetPullCursors();
    // Bypass the throttle for the recursive call — the bilateral link
    // is a discrete event that semantically resets visibility, so we
    // accept the second round-trip.
    lastPullStartedAt = 0;
    await pullSync({ force: true });
  } else if (unlinkTransitionDetected) {
    // Reconcile against the now-narrower visible match set. The
    // recursive pull above would already cover the link-transition
    // case (it re-pulls everything fresh), so we only do the explicit
    // prune when there's no link transition to share that work.
    await pruneLocalMatchesAgainstServer();
  }
}

async function pullEntity<T>(
  fetched: Promise<T>,
  write: (rows: T) => Promise<void>,
): Promise<void> {
  try {
    const rows = await fetched;
    await write(rows);
  } catch {
    // Per-endpoint failure is non-fatal: the other endpoints still
    // complete, and the next pullSync attempt will retry this one.
  }
}

export type ProfileMergeTransitions = {
  /** Set when a previously-unclaimed (or absent) owned profile gained a
   * `linkedUserId`. Triggers a cursor reset + recursive full pull so
   * the friend's pre-link match history lands. */
  link: boolean;
  /** Set when a previously-linked owned profile lost its `linkedUserId`
   * (e.g. the friend unlinked from their device — we learn about it
   * through pull-sync because *we* never called Unlink locally). The
   * incremental `?since=` matches pull doesn't represent deletions, so
   * the caller must run `pruneLocalMatchesAgainstServer` to drop the
   * matches that are no longer visible. */
  unlink: boolean;
};

async function mergeProfiles(
  rows: ApiProfile[],
): Promise<ProfileMergeTransitions> {
  if (rows.length === 0) return { link: false, unlink: false };

  const ids = rows.map((p) => p.id);
  const existing = await db.profiles.bulkGet(ids);
  const existingById = new Map<string, LocalProfile>();
  for (const p of existing) {
    if (p) existingById.set(p.id, p);
  }

  const toPut: LocalProfile[] = [];
  let linkTransition = false;
  let unlinkTransition = false;
  for (const p of rows) {
    const local = existingById.get(p.id);
    // LWW on updatedAt: skip when the local copy is at least as fresh.
    // Profile edits flow through `mutations.ts`, which bumps the local
    // updatedAt at write time; the server bumps on PATCH. A tie favours
    // local so a queued PATCH-then-pull doesn't undo the optimistic
    // value.
    if (local && local.updatedAt >= p.updatedAt) continue;
    // Detect unclaimed → linked transition. The fresh server row is
    // about to overwrite a local row that was unclaimed (or was never
    // seen locally before). When this happens the caller will reset
    // the matches cursor + re-pull, because the bilateral link just
    // widened visibility into matches the friend created pre-link.
    if (
      p.linkedUserId !== null &&
      (!local || local.linkedUserId === null)
    ) {
      linkTransition = true;
    }
    // Detect linked → unclaimed transition. The friend unlinked from
    // their device; our local copy still says "linked" but the server
    // is returning a cleared row. Pull-sync's `?since=` cursor can't
    // tell us which matches dropped out of visibility, so the caller
    // must run `pruneLocalMatchesAgainstServer` to reconcile.
    if (
      local &&
      local.linkedUserId !== null &&
      p.linkedUserId === null
    ) {
      unlinkTransition = true;
    }
    toPut.push({
      id: p.id,
      ownerId: p.ownerId,
      linkedUserId: p.linkedUserId,
      alias: p.alias,
      customAvatarUrl: p.customAvatarUrl,
      useLinkedAvatar: p.useLinkedAvatar,
      // Phase 7 stamp fields. `??` covers legacy server responses /
      // persisted-cache rows that predate the column.
      avatarFrame: p.avatarFrame ?? "circle",
      avatarRing: p.avatarRing ?? null,
      usedAt: p.usedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      linkedUser: p.linkedUser,
    });
  }
  if (toPut.length > 0) await db.profiles.bulkPut(toPut);
  return { link: linkTransition, unlink: unlinkTransition };
}

/**
 * Reconcile the local match cache against the server's current visible
 * set. Used when something happens that the incremental `?since=`
 * cursor can't represent: an explicit unlink (drops matches that were
 * only visible via the now-broken link) or pull-sync detecting that
 * the friend unlinked from their device.
 *
 * Anything still pending a POST in the sync queue is preserved —
 * pruning a not-yet-flushed match would cause the next queue flush to
 * re-create it after a flicker to empty.
 */
export async function pruneLocalMatchesAgainstServer(): Promise<void> {
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
        // Malformed queue entry — skip; the queue runner will surface
        // the failure separately.
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

// NOTE — server-side profile deletions (link-time merge, friend-side
// unlink) intentionally rely on the optimistic local deletion in the
// `mergeProfile` and `unlinkProfile` mutations rather than a
// pull-sync prune step. A naive prune races with optimistically
// created profiles that haven't yet been pushed to the server: the
// `?since=` delta doesn't include them, a full re-pull then wipes
// them, and the queued POST resurrects a phantom row. The corner
// case where a merge/unlink happens on another device while this one
// is offline shows the stale profile until the user explicitly
// triggers a merge or unlink locally; that's a documented
// limitation, not a regression to fix here.

async function mergeGames(rows: ApiGame[]): Promise<void> {
  const toPut: LocalGame[] = rows.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    iconUrl: g.iconUrl ?? null,
  }));
  if (toPut.length > 0) await db.games.bulkPut(toPut);

  // `/api/games` always returns the full catalogue (no `since` cursor),
  // so any local game id missing from the response is no longer canonical
  // and should be pruned. Without this, every `prisma db push --force-reset
  // && db:seed` cycle regenerates the seeded games' CUIDs (the seed upserts
  // by `slug`, so slug is stable but `id` changes), and the client's Dexie
  // mirror accumulates a fresh duplicate of each game on every reset.
  const incomingIds = new Set(rows.map((g) => g.id));
  const allLocal = await db.games.toCollection().primaryKeys();
  const stale = (allLocal as string[]).filter((id) => !incomingIds.has(id));
  if (stale.length > 0) await db.games.bulkDelete(stale);
}

async function mergeMatches(rows: ApiMatch[]): Promise<void> {
  if (rows.length === 0) return;

  const incomingMatchIds = rows.map((m) => m.id);
  const existing = await db.matches.bulkGet(incomingMatchIds);
  const existingById = new Map<string, LocalMatch>();
  for (const m of existing) {
    if (m) existingById.set(m.id, m);
  }

  const matchesToPut: LocalMatch[] = [];
  const playersToPut: LocalPlayer[] = [];
  const scoresToPut: LocalScore[] = [];
  const playerIdsToKeepByMatch = new Map<string, Set<string>>();
  const scoreIdsToKeepByMatch = new Map<string, Set<string>>();
  const matchesToReconcile: string[] = [];

  for (const m of rows) {
    // `/api/matches` always returns updatedAt; the shared ApiMatch
    // type widens it to optional/nullable for the legacy-cache
    // hydration path, so we normalize once here.
    const incomingUpdatedAt = m.updatedAt ?? m.startedAt;
    const local = existingById.get(m.id);
    if (local && local.updatedAt >= incomingUpdatedAt) {
      // Local copy wins or ties — skip, but still record incoming children
      // so we don't accidentally prune them below.
      const pIds = new Set<string>(local.id ? [] : []);
      const sIds = new Set<string>();
      playerIdsToKeepByMatch.set(m.id, pIds);
      scoreIdsToKeepByMatch.set(m.id, sIds);
      continue;
    }

    matchesToPut.push({
      id: m.id,
      gameId: m.gameId,
      createdById: m.createdById ?? null,
      status: m.status,
      victoryType: m.victoryType ?? null,
      winnerId: m.winnerId ?? null,
      metadata: m.metadata ?? {},
      startedAt: m.startedAt,
      completedAt: m.completedAt ?? null,
      updatedAt: incomingUpdatedAt,
    });
    matchesToReconcile.push(m.id);

    const pIds = new Set<string>();
    for (const p of m.players ?? []) {
      pIds.add(p.id);
      playersToPut.push({
        id: p.id,
        matchId: m.id,
        profileId: p.profileId,
        profileLinkedUserId: p.profile.linkedUserId,
        position: p.position,
        // Apply Phase 7 stamp defaults at the API → Dexie boundary so
        // every cached row carries the required fields, even when the
        // server response or persisted cache predates the column.
        profile: {
          ...p.profile,
          avatarFrame: p.profile.avatarFrame ?? "circle",
          avatarRing: p.profile.avatarRing ?? null,
        },
        updatedAt: p.updatedAt ?? incomingUpdatedAt,
      });
    }
    playerIdsToKeepByMatch.set(m.id, pIds);

    const sIds = new Set<string>();
    for (const s of m.scores ?? []) {
      sIds.add(s.id);
      scoresToPut.push({
        id: s.id,
        matchId: m.id,
        playerId: s.playerId,
        category: s.category,
        value: s.value,
        metadata: s.metadata ?? {},
        updatedAt: s.updatedAt ?? incomingUpdatedAt,
      });
    }
    scoreIdsToKeepByMatch.set(m.id, sIds);
  }

  if (matchesToPut.length > 0) await db.matches.bulkPut(matchesToPut);
  if (playersToPut.length > 0) await db.players.bulkPut(playersToPut);
  if (scoresToPut.length > 0) await db.scores.bulkPut(scoresToPut);

  // Prune child rows that no longer exist on the server (e.g. a player
  // removed in a future API; today this is a no-op, but the LWW story
  // breaks if we leave orphans behind).
  for (const matchId of matchesToReconcile) {
    const keepPlayers = playerIdsToKeepByMatch.get(matchId) ?? new Set<string>();
    const keepScores = scoreIdsToKeepByMatch.get(matchId) ?? new Set<string>();

    const localPlayers = await db.players.where("matchId").equals(matchId).toArray();
    const stalePlayerIds = localPlayers
      .filter((p) => !keepPlayers.has(p.id))
      .map((p) => p.id);
    if (stalePlayerIds.length > 0) await db.players.bulkDelete(stalePlayerIds);

    const localScores = await db.scores.where("matchId").equals(matchId).toArray();
    const staleScoreIds = localScores
      .filter((s) => !keepScores.has(s.id))
      .map((s) => s.id);
    if (staleScoreIds.length > 0) await db.scores.bulkDelete(staleScoreIds);
  }
}
