import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";

export type MatchSyncStatus = "synced" | "pending";

/**
 * Reactive flag: does this match still have outstanding `syncQueue`
 * entries waiting to reach the server?
 *
 * Used by the share-link affordance: the public share endpoint can
 * only return a payload for a match the *server* knows about, so a
 * match whose create-POST or completion-PUT is still queued (or
 * permanently failed) would 404. Returning "pending" here lets the
 * scoring screen disable the Share button until the queue drains, so
 * we don't ship users a button that's guaranteed to error.
 *
 * Returns "synced" while Dexie reads are in flight too — the absence
 * of a pending entry is the same outcome whether the queue is empty
 * or hasn't loaded yet, and the share dialog has its own 404 fallback
 * for the unlikely race.
 */
export function useMatchSyncStatus(matchId: string): MatchSyncStatus {
  const data = useLiveQuery(async () => {
    // Most queues are tiny (single-digit entries on a synced device)
    // so a full table scan + URL match is cheaper than maintaining a
    // dedicated index. If we ever ship batched bulk-imports this can
    // graduate to a per-match secondary index.
    const entries = await db.syncQueue.toArray();
    for (const entry of entries) {
      if (entry.url.includes(`/api/matches/${matchId}`)) {
        return "pending" as const;
      }
      // The POST that *creates* the match doesn't carry the id in the
      // URL — it's in the body. The match never lands server-side
      // until this one succeeds.
      if (entry.url === "/api/matches" && entry.body) {
        try {
          const parsed = JSON.parse(entry.body) as { id?: string };
          if (parsed.id === matchId) return "pending" as const;
        } catch {
          // body wasn't JSON — treat as not-this-match.
        }
      }
    }
    return "synced" as const;
  }, [matchId]);

  return data ?? "synced";
}
