import Dexie, { type EntityTable, type Transaction } from "dexie";

export type LocalProfile = {
  /** Name used as the primary key (names are the identity for local profiles). */
  name: string;
  avatarUrl?: string | null;
  /** Set when this profile has been linked to a server user. */
  linkedUserId?: string | null;
  /** ISO timestamp of last time this name was used — used for sorting suggestions. */
  usedAt: string;
  isSelf?: boolean;
};

export type SyncQueueEntry = {
  id?: number;
  method: string;
  url: string;
  body?: string;
  createdAt: string;
  retries: number;
  status: "pending" | "failed";
  /** Set when the entry has failed permanently (retries exhausted). */
  error?: string;
};

export type GameRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  iconUrl?: string | null;
};

export type MatchRow = {
  id: string;
  gameId: string;
  createdById?: string | null;
  status: "IN_PROGRESS" | "COMPLETED";
  victoryType: string | null;
  winnerId: string | null;
  metadata: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  /** ISO timestamp — LWW key for pull-sync merge. */
  updatedAt: string;
};

export type PlayerRow = {
  id: string;
  matchId: string;
  userId?: string | null;
  name: string;
  position: number;
  user?: { name: string; alias: string | null } | null;
  updatedAt: string;
};

export type ScoreRow = {
  id: string;
  matchId: string;
  playerId: string;
  category: string;
  value: number;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export type SyncMetaRow = {
  key: string;
  value: string;
};

class OnBoardDB extends Dexie {
  localProfiles!: EntityTable<LocalProfile, "name">;
  syncQueue!: EntityTable<SyncQueueEntry, "id">;
  games!: EntityTable<GameRow, "id">;
  matches!: EntityTable<MatchRow, "id">;
  players!: EntityTable<PlayerRow, "id">;
  scores!: EntityTable<ScoreRow, "id">;
  syncMeta!: EntityTable<SyncMetaRow, "key">;

  constructor() {
    super("onboard");

    // v1 — historical schema with `matchDrafts` and `syncQueue` indexed by retries.
    this.version(1).stores({
      localProfiles: "name, usedAt, linkedUserId",
      syncQueue: "++id, createdAt, retries",
      matchDrafts: "id, gameId, startedAt",
    });

    // v2 — local-first refactor. Adds full row mirrors for games/matches/
    // players/scores, a syncMeta keystore, and adds a `status` index to the
    // sync queue so live-query predicates can count pending entries directly.
    this.version(2)
      .stores({
        localProfiles: "name, usedAt, linkedUserId",
        syncQueue: "++id, createdAt, status",
        games: "id, slug",
        matches: "id, gameId, status, startedAt, updatedAt, [createdById+startedAt]",
        players: "id, matchId, [matchId+position]",
        scores: "id, matchId, [matchId+playerId+category], updatedAt",
        syncMeta: "key",
        matchDrafts: null, // drop — PR #11 abandoned, never wrote to it in shipped code.
      })
      .upgrade(async (tx) => {
        // Classify legacy syncQueue rows. The v1 schema used a free-form
        // `error` string ("" or unset for healthy, set for permanently failed).
        // v2 promotes that to an explicit status so the live-query indexer
        // can answer "pending count" without a full scan.
        await tx
          .table("syncQueue")
          .toCollection()
          .modify((row: SyncQueueEntry & { error?: string }) => {
            row.status = row.error ? "failed" : "pending";
          });

        // One-shot hydration from the abandoned TanStack Query persisted
        // cache. After this upgrade, mutations.ts writes to Dexie tables
        // directly and persistQueryClient is gone. If the localStorage
        // key is missing, malformed, or contains shapes we don't recognise,
        // we swallow and rely on pullSync() to repopulate on next online
        // session — the upgrade itself never fails the user's app boot.
        try {
          const raw = localStorage.getItem("onboard_query_cache");
          if (raw) {
            hydrateFromPersistedCache(tx, raw);
            localStorage.removeItem("onboard_query_cache");
          }
        } catch {
          // Cache parsing failures are best-effort; pullSync is the
          // authoritative recovery path.
        }
      });

    // v3 — adds `userId` to the players index so refreshLocalAliases
    // can query `db.players.where("userId").equals(currentUserId)`
    // without a full-table scan. No data migration needed; only the
    // index is added.
    this.version(3).stores({
      players: "id, matchId, userId, [matchId+position]",
    });
  }
}

/** Pull recognised query payloads out of the v1 TanStack-Query persisted
 * cache JSON and seed the new Dexie tables. Tolerant: anything we don't
 * recognise is skipped, never thrown. */
function hydrateFromPersistedCache(
  tx: Transaction,
  raw: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const queries = pickQueriesArray(parsed);
  if (!queries) return;

  for (const q of queries) {
    if (!q || typeof q !== "object") continue;
    const key = (q as { queryKey?: unknown }).queryKey;
    const data = (q as { state?: { data?: unknown } }).state?.data;
    if (!Array.isArray(key) || data === undefined) continue;

    // ["games"] — full games list
    if (key.length === 1 && key[0] === "games" && Array.isArray(data)) {
      seedGames(tx, data);
      continue;
    }
    // ["games", slug] — single game detail
    if (key.length === 2 && key[0] === "games" && typeof key[1] === "string") {
      seedGames(tx, [data]);
      continue;
    }
    // ["matches"] or ["matches", { gameId }] — match list
    if (key[0] === "matches" && Array.isArray(data)) {
      seedMatches(tx, data);
      continue;
    }
    // ["matches", id] — single match detail
    if (key[0] === "matches" && typeof key[1] === "string") {
      seedMatches(tx, [data]);
      continue;
    }
  }
}

function pickQueriesArray(parsed: unknown): unknown[] | null {
  if (!parsed || typeof parsed !== "object") return null;
  const clientState = (parsed as { clientState?: unknown }).clientState;
  if (!clientState || typeof clientState !== "object") return null;
  const queries = (clientState as { queries?: unknown }).queries;
  return Array.isArray(queries) ? queries : null;
}

function seedGames(tx: Transaction, rows: unknown[]): void {
  const games: GameRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const g = r as Partial<GameRow>;
    if (typeof g.id !== "string" || typeof g.slug !== "string") continue;
    games.push({
      id: g.id,
      slug: g.slug,
      name: g.name ?? g.slug,
      description: g.description ?? "",
      minPlayers: g.minPlayers ?? 1,
      maxPlayers: g.maxPlayers ?? 8,
      iconUrl: g.iconUrl ?? null,
    });
  }
  if (games.length > 0) {
    void tx.table("games").bulkPut(games);
  }
}

type ApiMatch = {
  id: string;
  gameId: string;
  game?: { id: string; slug: string; name: string };
  createdById?: string | null;
  status: "IN_PROGRESS" | "COMPLETED";
  victoryType?: string | null;
  winnerId?: string | null;
  metadata?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string | null;
  updatedAt?: string | null;
  players?: ApiPlayer[];
  scores?: ApiScore[];
};

type ApiPlayer = {
  id: string;
  matchId?: string;
  userId?: string | null;
  name: string;
  position: number;
  user?: { name: string; alias: string | null } | null;
  updatedAt?: string | null;
};

type ApiScore = {
  id: string;
  matchId?: string;
  playerId: string;
  category: string;
  value: number;
  metadata?: Record<string, unknown>;
  updatedAt?: string | null;
};

function seedMatches(tx: Transaction, rows: unknown[]): void {
  const matches: MatchRow[] = [];
  const players: PlayerRow[] = [];
  const scores: ScoreRow[] = [];
  const games: GameRow[] = [];

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const m = r as ApiMatch;
    if (typeof m.id !== "string" || typeof m.gameId !== "string") continue;

    const matchUpdatedAt = m.updatedAt ?? m.startedAt ?? new Date(0).toISOString();
    matches.push({
      id: m.id,
      gameId: m.gameId,
      createdById: m.createdById ?? null,
      status: m.status,
      victoryType: m.victoryType ?? null,
      winnerId: m.winnerId ?? null,
      metadata: m.metadata ?? {},
      startedAt: m.startedAt,
      completedAt: m.completedAt ?? null,
      updatedAt: matchUpdatedAt,
    });

    if (m.game && typeof m.game.id === "string") {
      games.push({
        id: m.game.id,
        slug: m.game.slug,
        name: m.game.name,
        description: "",
        minPlayers: 1,
        maxPlayers: 8,
        iconUrl: null,
      });
    }

    for (const p of m.players ?? []) {
      if (!p || typeof p.id !== "string") continue;
      players.push({
        id: p.id,
        matchId: m.id,
        userId: p.userId ?? null,
        name: p.name,
        position: p.position,
        user: p.user ?? null,
        updatedAt: p.updatedAt ?? matchUpdatedAt,
      });
    }
    for (const s of m.scores ?? []) {
      if (!s || typeof s.id !== "string") continue;
      scores.push({
        id: s.id,
        matchId: m.id,
        playerId: s.playerId,
        category: s.category,
        value: s.value,
        metadata: s.metadata ?? {},
        updatedAt: s.updatedAt ?? matchUpdatedAt,
      });
    }
  }

  if (matches.length > 0) void tx.table("matches").bulkPut(matches);
  if (players.length > 0) void tx.table("players").bulkPut(players);
  if (scores.length > 0) void tx.table("scores").bulkPut(scores);
  // bulkPut on existing rows is an upsert; safe even if seedGames also ran.
  if (games.length > 0) void tx.table("games").bulkPut(games);
}

export const db = new OnBoardDB();
