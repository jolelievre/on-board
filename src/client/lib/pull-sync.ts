import { api } from "./api";
import type { ApiGame, ApiMatch } from "./api-types";
import {
  db,
  type LocalGame,
  type LocalMatch,
  type LocalPlayer,
  type LocalScore,
} from "./db";

const SYNC_META_LAST_PULL = "lastPullAt";

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

/** Patch the cached `player.user.alias` on every local Player linked
 * to the given user id.
 *
 * Alias edits don't bump `Match.updatedAt` on the server (they only
 * touch the User row), so a subsequent `pullSync()` would LWW-skip
 * every match and leave Dexie's mirrored `player.user.alias` stale.
 * Settings calls this directly after `updateProfile` so the UI sees
 * the new alias on the next render without waiting for any external
 * bump. */
export async function refreshLocalAliases(
  userId: string,
  newAlias: string | null,
): Promise<void> {
  const players = await db.players.where("userId").equals(userId).toArray();
  if (players.length === 0) return;
  const ts = new Date().toISOString();
  for (const p of players) {
    p.user = {
      name: p.user?.name ?? p.name,
      alias: newAlias,
    };
    p.updatedAt = ts;
  }
  await db.players.bulkPut(players);
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
  const pulledAt = new Date().toISOString();

  const matchesUrl = since
    ? `/api/matches?since=${encodeURIComponent(since)}`
    : `/api/matches`;

  const [games, matches] = await Promise.all([
    api<ApiGame[]>("/api/games"),
    api<ApiMatch[]>(matchesUrl),
  ]);

  await db.transaction(
    "rw",
    [db.games, db.matches, db.players, db.scores, db.syncMeta],
    async () => {
      await mergeGames(games);
      await mergeMatches(matches);
      await setSyncMeta(SYNC_META_LAST_PULL, pulledAt);
    },
  );
}

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
        userId: p.userId ?? null,
        name: p.name,
        position: p.position,
        user: p.user ?? null,
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
