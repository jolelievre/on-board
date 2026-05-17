import Dexie, { type EntityTable } from "dexie";

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

export type LocalGame = {
  id: string;
  slug: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  iconUrl?: string | null;
};

export type LocalMatch = {
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

export type LocalPlayer = {
  id: string;
  matchId: string;
  userId?: string | null;
  name: string;
  position: number;
  user?: { name: string; alias: string | null } | null;
  updatedAt: string;
};

export type LocalScore = {
  id: string;
  matchId: string;
  playerId: string;
  category: string;
  value: number;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export type LocalSyncMeta = {
  key: string;
  value: string;
};

class OnBoardDB extends Dexie {
  localProfiles!: EntityTable<LocalProfile, "name">;
  syncQueue!: EntityTable<SyncQueueEntry, "id">;
  games!: EntityTable<LocalGame, "id">;
  matches!: EntityTable<LocalMatch, "id">;
  players!: EntityTable<LocalPlayer, "id">;
  scores!: EntityTable<LocalScore, "id">;
  syncMeta!: EntityTable<LocalSyncMeta, "key">;

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
    // The `userId` index on `players` is included from the start so
    // refreshLocalAliases can use it without a full-table scan.
    this.version(2)
      .stores({
        localProfiles: "name, usedAt, linkedUserId",
        syncQueue: "++id, createdAt, status",
        games: "id, slug",
        matches: "id, gameId, status, startedAt, updatedAt, [createdById+startedAt]",
        players: "id, matchId, userId, [matchId+position]",
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
      });
  }
}

export const db = new OnBoardDB();
