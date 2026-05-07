import { db, type SyncQueueEntry } from "./db";
import { queryClient } from "./query-client";
import type { Match } from "../types/match";

const MAX_RETRIES = 3;

/**
 * Substitute every occurrence of each `from` string with its `to` value,
 * inside `text`. Used to rewrite draft ids → real server ids in URLs and
 * JSON-serialized request bodies.
 *
 * String-level replace (rather than JSON walking) is safe because draft ids
 * are formatted with a `draft_` / `draftp_` prefix + a UUID — they cannot
 * collide with anything else on the wire.
 */
function substitute(
  text: string | undefined,
  map: ReadonlyMap<string, string>,
): string | undefined {
  if (!text || map.size === 0) return text;
  let out = text;
  for (const [from, to] of map) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

export const syncEngine = {
  /**
   * Enqueue an API mutation to be replayed when connectivity returns.
   * Also used when offline to record intent.
   */
  async enqueue(method: string, url: string, body?: unknown): Promise<void> {
    await db.syncQueue.add({
      method,
      url,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      createdAt: new Date().toISOString(),
      retries: 0,
    });
  },

  /** Number of entries still pending in the queue. */
  async pendingCount(): Promise<number> {
    return db.syncQueue.where("error").equals("").count().catch(() =>
      db.syncQueue.filter((e) => !e.error).count()
    );
  },

  /**
   * Replay all queued mutations in creation order.
   * Successful entries are deleted; failed entries increment retry count.
   * Entries that exceed MAX_RETRIES are marked with an error string.
   *
   * Draft reconciliation: when a queued POST /api/matches carries a
   * `draftId` in its body, the response is treated as the canonical match
   * and the draft↔real id map is built (match id + per-position player
   * ids). All subsequent entries get their URL and body rewritten before
   * being fetched, so a queued `PATCH /api/matches/draft_xxx/scores` for
   * `playerId: draftp_yyy` becomes `PATCH /api/matches/<realMatchId>/scores`
   * for `playerId: <realPlayerId>`.
   *
   * After flushing, invalidates all TanStack Query caches so stale
   * optimistic data is replaced with fresh server state.
   */
  async flush(): Promise<void> {
    if (!navigator.onLine) return;

    const entries = await db.syncQueue
      .filter((e) => !e.error)
      .sortBy("createdAt");

    // Maps draft ids to the real ids returned by the server. Built up as we
    // process the queue. Pre-seeded from any matchDrafts row that already
    // has a realId — covers the case where flush partially succeeded
    // before (POST replayed, score PATCHes still queued).
    const matchIdMap = new Map<string, string>();
    const playerIdMap = new Map<string, string>();
    const resolvedDrafts = await db.matchDrafts.toArray();
    for (const d of resolvedDrafts) {
      if (d.realId) matchIdMap.set(d.id, d.realId);
    }

    let anySuccess = false;

    for (const entry of entries) {
      const url = substitute(entry.url, matchIdMap)!;
      const body = substitute(
        substitute(entry.body, matchIdMap),
        playerIdMap,
      );

      try {
        const res = await fetch(url, {
          method: entry.method,
          headers: { "Content-Type": "application/json" },
          body,
        });

        if (res.ok) {
          await maybeRecordDraftMapping(entry, res, matchIdMap, playerIdMap);
          await db.syncQueue.delete(entry.id!);
          anySuccess = true;
        } else if (res.status === 401 || res.status === 403) {
          await db.syncQueue.update(entry.id!, { error: `HTTP ${res.status}` });
        } else {
          await incrementRetry(entry);
        }
      } catch {
        // Network error mid-flush — stop; will retry on next reconnect.
        break;
      }
    }

    if (anySuccess) {
      await reconcileDrafts(matchIdMap);
      await queryClient.invalidateQueries();
      // Notify any listeners (e.g. the match route sitting on a now-stale
      // /matches/draft_xxx URL) that drafts may have been resolved.
      if (matchIdMap.size > 0 && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(SYNC_DRAFTS_RESOLVED_EVENT, {
            detail: { mappings: Object.fromEntries(matchIdMap) },
          }),
        );
      }
    }
  },
};

export const SYNC_DRAFTS_RESOLVED_EVENT = "onboard:sync-drafts-resolved";

export type SyncDraftsResolvedDetail = {
  mappings: Record<string, string>;
};

/**
 * If the just-succeeded entry is the POST that created a draft match,
 * extract the real match + player ids from the response and stash the
 * mappings.
 */
async function maybeRecordDraftMapping(
  entry: SyncQueueEntry,
  res: Response,
  matchIdMap: Map<string, string>,
  playerIdMap: Map<string, string>,
): Promise<void> {
  if (entry.method !== "POST") return;
  if (entry.url !== "/api/matches") return;
  if (!entry.body) return;

  let reqBody: {
    draftId?: string;
    players?: { position: number; draftPlayerId?: string }[];
  };
  try {
    reqBody = JSON.parse(entry.body);
  } catch {
    return;
  }
  if (!reqBody.draftId) return;

  let created: Match;
  try {
    created = (await res.clone().json()) as Match;
  } catch {
    return;
  }
  if (!created?.id) return;

  matchIdMap.set(reqBody.draftId, created.id);
  for (const dp of reqBody.players ?? []) {
    if (!dp.draftPlayerId) continue;
    const real = created.players.find((p) => p.position === dp.position);
    if (real) playerIdMap.set(dp.draftPlayerId, real.id);
  }

  await db.matchDrafts.update(reqBody.draftId, { realId: created.id });
  // Seed the per-match cache with the real id so a navigation away
  // from `/matches/draft_xxx` lands on a populated detail page.
  queryClient.setQueryData(["matches", created.id], created);
}

/**
 * After a flush pass, drop any matchDrafts row that has been fully
 * reconciled — both conditions must hold:
 *
 *   1. The row has a `realId` (its POST replayed in this pass or a prior one)
 *   2. No remaining queue entry's URL or body still references the draft id
 *
 * The row is the canonical source for the `draft_xxx → realId` mapping when
 * a flush pre-loads from Dexie (`syncEngine.flush`'s opening read), so it
 * must outlive every queue entry that depends on it. Deleting too early
 * would strand any queued PATCH still carrying the draft id — they would
 * fire post-reload with `/api/matches/draft_xxx/...` and 404.
 *
 * The match route reads this row on mount to redirect a stale
 * `/matches/draft_xxx` URL to `/matches/<realId>`. The route does NOT
 * delete the row — sync owns the lifecycle.
 */
async function reconcileDrafts(matchIdMap: Map<string, string>): Promise<void> {
  if (matchIdMap.size === 0) return;
  const remaining = await db.syncQueue
    .filter((e) => !e.error)
    .toArray();
  const stillReferenced = new Set<string>();
  for (const entry of remaining) {
    for (const draftId of matchIdMap.keys()) {
      if (entry.url.includes(draftId) || entry.body?.includes(draftId)) {
        stillReferenced.add(draftId);
      }
    }
  }
  for (const [draftId] of matchIdMap) {
    if (stillReferenced.has(draftId)) continue;
    const row = await db.matchDrafts.get(draftId);
    if (row?.realId) {
      await db.matchDrafts.delete(draftId);
    }
  }
}

async function incrementRetry(entry: SyncQueueEntry) {
  const nextRetries = entry.retries + 1;
  if (nextRetries >= MAX_RETRIES) {
    await db.syncQueue.update(entry.id!, {
      retries: nextRetries,
      error: `Max retries reached`,
    });
  } else {
    await db.syncQueue.update(entry.id!, { retries: nextRetries });
  }
}

export const __test__ = { substitute };
