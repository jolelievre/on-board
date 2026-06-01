import Dexie, { type EntityTable } from "dexie";

export type LocalProfileLinkedUser = {
  id: string;
  name: string;
  alias: string | null;
  avatarUrl: string | null;
  /** Added in 6-C so the linked-friend card can show which Google
   * account the profile binds to. Optional for legacy mirrors that
   * predate this projection. */
  email?: string;
};

/** Stamp frame shape — controls border-radius on the rendered avatar.
 * "circle" is the default for legacy rows (and the v6 upgrader default).
 * "tag" is the asymmetric-radius scrapbook look. */
export type AvatarFrame = "circle" | "rounded" | "tag";

/** Stamp colour ring — one of the 8 7WD category keys or null for no
 * ring. Stored as a key (not hex) so it re-themes between Parchment
 * and Candlelit. Mirrors the `Category` union in
 * `src/client/components/ui/category.ts`. */
export type AvatarRing =
  | "civil"
  | "scientific"
  | "commercial"
  | "guilds"
  | "wonders"
  | "progress"
  | "treasury"
  | "military"
  | null;

/** Server-mirrored Profile row (Phase 6-A). One per person the user knows.
 * Owned by the user when unclaimed; visible to both owner and linked user
 * once `linkedUserId` is set. UI reads through this table exclusively. */
export type LocalProfile = {
  id: string;
  ownerId: string;
  linkedUserId: string | null;
  alias: string;
  customAvatarUrl: string | null;
  useLinkedAvatar: boolean;
  /** Phase 7: stamp shape. Defaults to "circle" for v5-and-earlier rows
   * that predate the column; the next pull-sync brings down the
   * server's authoritative value. */
  avatarFrame: AvatarFrame;
  /** Phase 7: stamp colour ring. `null` = no ring. */
  avatarRing: AvatarRing;
  /** ISO timestamp — drives suggestion ordering. */
  usedAt: string;
  createdAt: string;
  /** ISO timestamp — LWW key for pull-sync merge. */
  updatedAt: string;
  /** Denormalized linked-user projection. Null when unclaimed. */
  linkedUser: LocalProfileLinkedUser | null;
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

/** Denormalized Profile projection embedded on each Player row when
 * pulled from the server. Lets the UI render every player (name,
 * avatar, viewer-aware override for the linked user) without a
 * separate Profile lookup. Includes the linked auth user when the
 * profile is claimed — null when unclaimed. */
export type LocalPlayerProfile = {
  id: string;
  ownerId: string;
  linkedUserId: string | null;
  alias: string;
  customAvatarUrl: string | null;
  useLinkedAvatar: boolean;
  /** Phase 7 stamp fields — mirrored from the Profile row so every
   * consumer surface (match history, scoreboard, banners) reads a
   * consistent stamp. Defaults applied at read time when undefined
   * (Dexie rows from v5 don't have these fields until the next pull). */
  avatarFrame: AvatarFrame;
  avatarRing: AvatarRing;
  linkedUser: {
    id: string;
    name: string;
    alias: string | null;
    avatarUrl: string | null;
  } | null;
};

export type LocalPlayer = {
  id: string;
  matchId: string;
  profileId: string;
  /** Mirror of `profile.linkedUserId`, denormalized to the top level
   * so Dexie can index it. `collectPersonPlayers` reads this to
   * surface every match where a given person played, regardless of
   * which Profile row represented them at that point. Null when the
   * profile is unclaimed. */
  profileLinkedUserId: string | null;
  position: number;
  /** Embedded Profile snapshot from the most recent pull. Lets the UI
   * render player names/avatars even when the viewer doesn't have
   * standalone visibility into the Profile row. */
  profile: LocalPlayerProfile;
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
  syncQueue!: EntityTable<SyncQueueEntry, "id">;
  games!: EntityTable<LocalGame, "id">;
  matches!: EntityTable<LocalMatch, "id">;
  players!: EntityTable<LocalPlayer, "id">;
  scores!: EntityTable<LocalScore, "id">;
  profiles!: EntityTable<LocalProfile, "id">;
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

    // v3 — Phase 6-A: introduce the Profile entity as the domain person
    // and drop the name-keyed `localProfiles` table that v2 used for
    // autocomplete suggestions. `profiles` and `profileGroup*` mirror
    // their server tables; player rows gain a `profileId` index so we
    // can look up "who is this player" without scanning. `localProfiles`
    // is dropped — the next pullSync repopulates `profiles` from the
    // server (which the migration has already backfilled).
    this.version(3).stores({
      localProfiles: null, // drop — replaced by the server-mirrored profiles table.
      syncQueue: "++id, createdAt, status",
      games: "id, slug",
      matches: "id, gameId, status, startedAt, updatedAt, [createdById+startedAt]",
      players: "id, matchId, userId, profileId, [matchId+position]",
      scores: "id, matchId, [matchId+playerId+category], updatedAt",
      profiles: "id, ownerId, linkedUserId, usedAt, updatedAt",
      profileGroups: "id, ownerId, updatedAt",
      profileGroupMembers: "[groupId+profileId], groupId, profileId",
      syncMeta: "key",
    });

    // v4 — Phase 6-C: single-Profile refactor. Player rows now embed
    // the Profile projection so cross-user matches render correctly
    // even when the viewer can't pull the Profile row standalone.
    // The `userId` index is dropped (column gone server-side); a new
    // `profileLinkedUserId` index powers `collectPersonPlayers`'
    // "all matches where this person played" query without scans.
    // Existing rows are wiped — the next pullSync repopulates from
    // the new server projection in one round-trip.
    this.version(4)
      .stores({
        syncQueue: "++id, createdAt, status",
        games: "id, slug",
        matches: "id, gameId, status, startedAt, updatedAt, [createdById+startedAt]",
        players: "id, matchId, profileId, profileLinkedUserId, [matchId+position]",
        scores: "id, matchId, [matchId+playerId+category], updatedAt",
        profiles: "id, ownerId, linkedUserId, usedAt, updatedAt",
        profileGroups: "id, ownerId, updatedAt",
        profileGroupMembers: "[groupId+profileId], groupId, profileId",
        syncMeta: "key",
      })
      .upgrade(async (tx) => {
        // The old v3 rows lack the embedded `profile` projection. The
        // simplest, safest path is to drop every cached Player row and
        // force a full re-pull on next boot — clears the
        // `lastPullAt` cursor so pull-sync fetches everything from
        // scratch.
        await tx.table("players").clear();
        await tx.table("matches").clear();
        await tx.table("scores").clear();
        await tx
          .table("syncMeta")
          .where("key")
          .equals("lastMatchPullAt")
          .delete();
      });

    // v5 — Phase 6-E cleanup: drop the unused `profileGroups` and
    // `profileGroupMembers` stores. Phase 6-D (favorite player groups)
    // was abandoned in favor of the "played-with" suggestions shipped
    // in PR 6-B; neither store ever received any rows.
    this.version(5).stores({
      syncQueue: "++id, createdAt, status",
      games: "id, slug",
      matches: "id, gameId, status, startedAt, updatedAt, [createdById+startedAt]",
      players: "id, matchId, profileId, profileLinkedUserId, [matchId+position]",
      scores: "id, matchId, [matchId+playerId+category], updatedAt",
      profiles: "id, ownerId, linkedUserId, usedAt, updatedAt",
      profileGroups: null,
      profileGroupMembers: null,
      syncMeta: "key",
    });

    // v6 — Phase 7: introduce stamp fields (`avatarFrame`, `avatarRing`)
    // on Profile + the embedded Player.profile projection. No indexes
    // change (the new fields are read-only render inputs, never query
    // keys). The upgrader backfills "circle" / null on existing rows
    // so the UI can read them unconditionally before the next pull-sync
    // brings down the server's authoritative values.
    this.version(6)
      .stores({
        syncQueue: "++id, createdAt, status",
        games: "id, slug",
        matches:
          "id, gameId, status, startedAt, updatedAt, [createdById+startedAt]",
        players:
          "id, matchId, profileId, profileLinkedUserId, [matchId+position]",
        scores: "id, matchId, [matchId+playerId+category], updatedAt",
        profiles: "id, ownerId, linkedUserId, usedAt, updatedAt",
        syncMeta: "key",
      })
      .upgrade(async (tx) => {
        await tx
          .table("profiles")
          .toCollection()
          .modify((row: Partial<LocalProfile>) => {
            if (row.avatarFrame === undefined) row.avatarFrame = "circle";
            if (row.avatarRing === undefined) row.avatarRing = null;
          });
        await tx
          .table("players")
          .toCollection()
          .modify((row: LocalPlayer) => {
            if (row.profile.avatarFrame === undefined)
              row.profile.avatarFrame = "circle";
            if (row.profile.avatarRing === undefined)
              row.profile.avatarRing = null;
          });
      });
  }
}

export const db = new OnBoardDB();
