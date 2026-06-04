import { db, type SyncQueueEntry } from "./db";

/**
 * Infer which user a queued mutation belongs to by walking from the
 * entry's URL / body back to the local Dexie row it operates on, and
 * reading that row's `ownerId` / `createdById`.
 *
 * IndexedDB is scoped per-origin (per browser, per domain), not per
 * user. When the same browser hosts multiple successive logins (account
 * switch, shared family device, test/prod accounts), every user's
 * historical `syncQueue` entries pile up in one shared store. Without
 * this attribution step, a flush triggered by user B would replay user
 * A's queued mutations using B's session cookie — at best 4xx-failing,
 * at worst attributing A's data to B. The Settings panel would also
 * surface A's entries as if they were B's, letting B Retry / Discard
 * mutations they don't own.
 *
 * We do not store the user id on the queue entry itself. Inference is
 * preferred because:
 *   • Self-healing — old entries (e.g. the pre-v2 `draft_*` orphans
 *     whose match rows were dropped at the v2 upgrade) resolve to
 *     `null` and disappear from every consumer without a migration.
 *   • Forward-proof — every queued endpoint maps to a `matchId` or
 *     `profileId` already mirrored in Dexie with the owning user. A
 *     new endpoint joining the queue only needs a branch added to
 *     `parseTarget`.
 *   • No schema bump, no upgrader pass, no risk of the queue's stored
 *     userId drifting away from the canonical Dexie row's owner.
 */

const PROFILE_BY_ID_RE = /^\/api\/profiles\/([^/?]+)(?:\/.*)?$/;
const MATCH_BY_ID_RE = /^\/api\/matches\/([^/?]+)(?:\/.*)?$/;

type EntryTarget =
  | { kind: "profile"; id: string }
  | { kind: "match"; id: string }
  | null;

/** Parse the entry's URL / body to identify which Dexie row owns it.
 * Returns null for entries whose target can't be determined (unknown
 * endpoint, malformed body). The caller treats null as "not the
 * current user" — safe-by-default: a queue entry we can't attribute
 * stays inert rather than being replayed under the wrong session. */
function parseTarget(entry: SyncQueueEntry): EntryTarget {
  const url = stripQueryString(entry.url);

  // URLs that carry the id directly:
  //   PATCH/PUT /api/matches/:id
  //   PATCH /api/matches/:id/scores
  //   PATCH /api/profiles/:id
  //   POST /api/profiles/:targetId/merge
  const matchUrl = MATCH_BY_ID_RE.exec(url);
  if (matchUrl) return { kind: "match", id: matchUrl[1] };

  const profileUrl = PROFILE_BY_ID_RE.exec(url);
  if (profileUrl) return { kind: "profile", id: profileUrl[1] };

  // Collection POSTs — id lives in the body (the mutation generates a
  // cuid client-side and embeds it for idempotent server-side upsert).
  if (entry.method === "POST" && url === "/api/matches") {
    const id = readBodyId(entry.body);
    if (id !== null) return { kind: "match", id };
  }
  if (entry.method === "POST" && url === "/api/profiles") {
    const id = readBodyId(entry.body);
    if (id !== null) return { kind: "profile", id };
  }

  return null;
}

function readBodyId(body: string | undefined): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

function stripQueryString(url: string): string {
  const queryAt = url.indexOf("?");
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

/** Look up the user id that owns the local row this entry targets.
 *
 * Returns `null` when:
 *   • the target couldn't be parsed (unknown URL shape, missing body
 *     id) — e.g. the pre-v2 `draft_*` rows whose `matchDrafts` table
 *     was dropped at v2
 *   • the parsed target id has no matching Dexie row — e.g. a stale
 *     entry whose match was wiped by the v4 upgrader, or a foreign
 *     user's row that was never mirrored into our Dexie
 *
 * Callers treat `null` as "not the current user" so these entries
 * never replay and never appear in the Sync panel. */
export async function inferEntryOwnerId(
  entry: SyncQueueEntry,
): Promise<string | null> {
  const target = parseTarget(entry);
  if (!target) return null;

  if (target.kind === "match") {
    const match = await db.matches.get(target.id);
    return match?.createdById ?? null;
  }
  // target.kind === "profile"
  const profile = await db.profiles.get(target.id);
  return profile?.ownerId ?? null;
}

/** Filter a batch of queue entries to those owned by `currentUserId`.
 * Entries whose owner inference returns null (orphans, foreign users)
 * are dropped. */
export async function filterOwnedBy(
  entries: SyncQueueEntry[],
  currentUserId: string,
): Promise<SyncQueueEntry[]> {
  const owned: SyncQueueEntry[] = [];
  for (const entry of entries) {
    const ownerId = await inferEntryOwnerId(entry);
    if (ownerId === currentUserId) owned.push(entry);
  }
  return owned;
}
