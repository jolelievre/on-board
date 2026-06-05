import Dexie, { type EntityTable } from "dexie";
import type { SyncErrorBody } from "../../shared/sync-errors";

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
  /** Phase 8-G soft-delete tombstone. Optional so v7-and-earlier rows
   * (where the column didn't exist) keep meaning "active". `mergeProfiles`
   * hard-deletes the local row on any incoming row carrying a
   * `deletedAt`; this field is therefore only ever observed transiently
   * during a single merge pass. Active-read hooks filter
   * `deletedAt == null` defensively so a queued delete that's mid-flight
   * still hides the row from suggestions / stats / Players tab. */
  deletedAt?: string;
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
  /** `pending` — eligible for the next flush.
   *  `failed` — terminal failure (4xx, or 5xx after the retry budget).
   *  `blocked` — Phase 8-F cascading-failure marker. A later entry
   *  whose body / URL references a client-supplied id that appeared in
   *  an upstream `failed` entry. Skipped by the replayer; flipped back
   *  to `pending` automatically when the upstream entry succeeds (via
   *  Retry, or because the upstream eventually drained).
   *  `discarded` — Phase 8-F tombstone. The user explicitly gave up on
   *  the entry from the Sync panel; the row stays in the queue so
   *  downstream gates that scan it (e.g. `useMatchSyncStatus` for the
   *  Share button) still treat the match / profile as not-yet-synced.
   *  Skipped by the replayer; ignored by the failed-banner / telemetry
   *  reporter. Can be undone by Retry, which flips it back to `pending`. */
  status: "pending" | "failed" | "blocked" | "discarded";
  /** Set on `blocked` rows: the `id` of the upstream failed entry that
   * caused the cascade. Drives auto-unblock on parent success, and the
   * Sync panel's "Blocked by …" badge. */
  blockedBy?: number;
  /** Free-form short summary (e.g. `HTTP 400`, `Max retries reached`).
   * Kept for backwards-compat with v2-era rows that didn't have
   * `errorBody`. The Sync panel falls back to this when `errorBody`
   * is absent. */
  error?: string;
  /** Structured server error body — `{ error, field?, hint? }` — captured
   * verbatim from the last failed response. Phase 8-E: lets the Sync
   * panel render an actionable message instead of just an HTTP code.
   * Absent on transient network errors (no response body to log). */
  errorBody?: SyncErrorBody;
  /** Status code of the response that triggered the failure. Powers
   * the panel's "Authorization" vs "Validation" grouping without the
   * UI having to re-parse `error`. */
  errorStatus?: number;
  /** Wall-clock ISO timestamp when the entry was last marked failed.
   * Drives "1 hour ago" hints in the panel. */
  failedAt?: string;
  /** Phase 8-E telemetry: set true once the entry has been included in
   * a `POST /api/sync/failures` report so a repeating pull-sync doesn't
   * re-post the same row. Cleared by 8-F's Retry action so a fresh
   * failure gets reported again. */
  reported?: boolean;
  /** Phase 8-G — authoritative owner stamp captured at enqueue time.
   * When set, `inferEntryOwnerId` reads this directly and skips the
   * row-walking inference. Required for DELETE entries because the
   * mutation hard-deletes the local Dexie row before flush runs, so
   * the row-based inference would return null and `filterOwnedBy`
   * would drop the entry as foreign. Optional on legacy entries —
   * the row inference handles them. */
  ownerId?: string;
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
  /** Phase 8-G soft-delete tombstone. `mergeMatches` hard-deletes the
   * local match + its players + scores on any incoming row carrying a
   * `deletedAt`; this field is therefore transient (only observed during
   * a single merge pass). Optional so v7-and-earlier rows keep meaning
   * "active". */
  deletedAt?: string;
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

    // v7 — Phase 8-F: sync queue recovery. Adds `blocked` as a third
    // status value plus a `blockedBy` foreign key onto the same
    // `syncQueue` table. No new indexes — the existing `status` index
    // still answers all live-query predicates ("pending count", "any
    // failed", "any blocked"). The upgrader runs a retroactive
    // cascade scan over the existing `failed` rows so users on
    // 8-E-era queues land with their dependents already grouped
    // under the upstream failure — without it, those users would see
    // 30+ unrelated `failed` entries and have to Retry every one by
    // hand instead of clicking Retry on the parent and letting the
    // cascade drain.
    this.version(7)
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
        // Sort by createdAt so older failures get a chance to "claim"
        // their dependents before younger failures do. A dependent of
        // two upstream failures is attributed to the older one — once
        // that resolves, the younger failure (if still failed) blocks
        // it again on the next flush.
        const all = (await tx
          .table("syncQueue")
          .orderBy("createdAt")
          .toArray()) as SyncQueueEntry[];
        for (const parent of all) {
          if (parent.status !== "failed" || parent.id === undefined) continue;
          const parentIds = extractClientIds(parent);
          if (parentIds.length === 0) continue;
          for (const candidate of all) {
            if (candidate.id === undefined) continue;
            if (candidate.id === parent.id) continue;
            if (candidate.createdAt <= parent.createdAt) continue;
            if (candidate.status === "blocked") continue;
            if (!entryReferencesAny(candidate, parentIds)) continue;
            await tx.table("syncQueue").update(candidate.id, {
              status: "blocked",
              blockedBy: parent.id,
            });
            // Mutate in-place so subsequent iterations skip this row.
            candidate.status = "blocked";
            candidate.blockedBy = parent.id;
          }
        }
      });

    // v8 — Phase 8-G: introduce `deletedAt` on `LocalMatch` and
    // `LocalProfile` (tombstone propagation for delete-match and
    // delete-profile). No index changes — `deletedAt` is read alongside
    // each row and filtered in-memory by the active hooks. No upgrader
    // needed: the field is optional, and an absent value on legacy rows
    // reads as "active". The version bump is bookkeeping so a future
    // schema change can chain off v8 cleanly.
    this.version(8).stores({
      syncQueue: "++id, createdAt, status",
      games: "id, slug",
      matches:
        "id, gameId, status, startedAt, updatedAt, [createdById+startedAt]",
      players:
        "id, matchId, profileId, profileLinkedUserId, [matchId+position]",
      scores: "id, matchId, [matchId+playerId+category], updatedAt",
      profiles: "id, ownerId, linkedUserId, usedAt, updatedAt",
      syncMeta: "key",
    });
  }
}

/** Extract every client-supplied cuid-like id from an entry's URL and
 * JSON body. Used by the cascade marker to find later entries that
 * depend on this one (their body / URL contains one of these strings).
 *
 * Lives in db.ts (not sync.ts) so the v7 upgrader can call it without
 * pulling sync.ts in at module-init time. Kept exported for the
 * sync engine to import.
 *
 * Implementation: scan with `/[a-z0-9]{20,}/g`. Real cuids are 24+
 * alphanumeric lowercase; the legacy `draft_<uuid>` ids (10/05 entries
 * from the user's stuck queue) don't match — but that's fine, those
 * orphans have no parent in the queue and never act as a "parent" in
 * the cascade sense. */
export function extractClientIds(entry: SyncQueueEntry): string[] {
  const haystack = `${entry.url}\n${entry.body ?? ""}`;
  const matches = haystack.match(/[a-z0-9]{20,}/g);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

/** Does the candidate entry's URL or body contain any of the given
 * client-supplied ids as a substring? */
export function entryReferencesAny(
  candidate: SyncQueueEntry,
  ids: string[],
): boolean {
  if (ids.length === 0) return false;
  const haystack = `${candidate.url}\n${candidate.body ?? ""}`;
  return ids.some((id) => haystack.includes(id));
}

export const db = new OnBoardDB();
