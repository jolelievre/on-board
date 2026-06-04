import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  entryReferencesAny,
  extractClientIds,
  type SyncQueueEntry,
} from "./db";
import type { SyncErrorBody } from "../../shared/sync-errors";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { requireCachedUserId } from "../hooks/useAuthSession";
import { useRequiredViewerId } from "../hooks/useRequiredViewerId";
import { filterOwnedBy, inferEntryOwnerId } from "./sync-ownership";

const MAX_RETRIES = 3;

/** Window during which a freshly-drained queue shows "saved" before
 * falling back to "idle". Long enough that the user notices the
 * confirmation, short enough that it doesn't feel sticky. */
const SAVED_LINGER_MS = 1200;

/** How often `useStatus` retries `flush()` while we believe we're
 * online but the queue isn't draining. Covers the case where the
 * browser's `online` event never fired (DevTools throttling release,
 * captive portal, VPN reconnect) so the normal flush trigger is silent. */
const PENDING_RETRY_MS = 10_000;

export type SyncStatus = "idle" | "saving" | "offline" | "saved";

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
      status: "pending",
    });
  },

  /** Number of pending queue entries owned by the currently logged-in
   * user. Foreign-user entries (other accounts whose Dexie rows still
   * sit on this device) are excluded so the "saving" pill never lights
   * up for mutations the current user can't actually replay. */
  async pendingCount(): Promise<number> {
    const currentUserId = requireCachedUserId();
    const all = await db.syncQueue.where("status").equals("pending").toArray();
    const owned = await filterOwnedBy(all, currentUserId);
    return owned.length;
  },

  /**
   * Replay all queued mutations in creation order.
   * Successful entries are deleted; failed entries increment retry count.
   * Entries that exceed MAX_RETRIES are marked `status: "failed"`.
   *
   * Phase 8-F: on each terminal failure, scans later `pending` entries
   * for a body / URL match against the failed entry's client-supplied
   * ids and marks them `blocked` so they don't burn their own retry
   * budget chasing an upstream that will never land. On each success,
   * any entries previously blocked by this id auto-unblock back to
   * `pending` and replay in the same flush pass.
   *
   * After a successful flush, triggers `pullSync()` to merge any
   * cross-device updates back into Dexie.
   */
  async flush(): Promise<void> {
    if (!navigator.onLine) return;
    // Multi-user safety: only replay entries owned by the currently
    // logged-in user. Without this, an account switch on the same
    // browser would let user B's flush replay user A's queued
    // mutations under B's session cookie — which either re-fails
    // permanently (B can't write A's resources) or, worse, attributes
    // A's data to B. Inference resolves the owner from the local Dexie
    // row each entry targets; see `sync-ownership.ts`.
    const currentUserId = requireCachedUserId();

    let anySuccess = false;

    // Loop because successful drains can unblock other entries; we want
    // those to replay in the same flush rather than waiting for the next
    // online tick. Bounded by progress — exits when a pass moves nothing.
    while (true) {
      const allPending = await db.syncQueue
        .where("status")
        .equals("pending")
        .sortBy("createdAt");
      const entries = await filterOwnedBy(allPending, currentUserId);
      if (entries.length === 0) break;

      let madeProgress = false;
      let networkError = false;

      for (const entry of entries) {
        try {
          const res = await fetch(entry.url, {
            method: entry.method,
            headers: { "Content-Type": "application/json" },
            body: entry.body,
          });

          if (res.ok) {
            await db.syncQueue.delete(entry.id!);
            await unblockDependents(entry.id!);
            anySuccess = true;
            madeProgress = true;
          } else if (res.status === 401 || res.status === 403) {
            // Auth or ownership failure — replaying won't change the outcome.
            const errorBody = await readStructuredErrorBody(res);
            await markEntryFailed(entry, errorBody, res.status);
            madeProgress = true;
          } else if (res.status >= 400 && res.status < 500) {
            // Other 4xx (validation, conflict, not-found) — replays won't fix
            // these, so mark terminal immediately rather than burning the
            // retry budget. The server's structured body lets the Sync
            // panel render an actionable message for diagnosis (Phase 8-E).
            const errorBody = await readStructuredErrorBody(res);
            await markEntryFailed(entry, errorBody, res.status);
            madeProgress = true;
          } else {
            // 5xx — server-side glitch, retry per the budget.
            const becameFailed = await incrementRetry(entry, res);
            if (becameFailed) madeProgress = true;
          }
        } catch {
          // Network error mid-flush — stop; will retry on next reconnect.
          networkError = true;
          break;
        }
      }

      if (networkError) break;
      if (!madeProgress) break;
    }

    if (anySuccess) {
      // Lazy-imported to break the sync.ts ↔ pull-sync.ts cycle (pull-sync
      // imports `syncEngine.enqueue` indirectly via api error retries; we
      // don't want either module to require the other at top level).
      const { pullSync } = await import("./pull-sync");
      void pullSync().catch(() => {
        // Pull failures are non-fatal; UI keeps showing local data and
        // the next flush or reconnect will retry the pull.
      });
    }
  },

  /** Re-queue a failed / blocked entry. Resets retries and clears the
   * failure metadata so the engine treats it as a fresh attempt and the
   * 8-E machinery captures a fresh `errorBody` on a re-fail (the user
   * sees the *current* server error, not last time's stale string).
   *
   * Also unblocks every entry whose `blockedBy` points at this one — if
   * the user is retrying the parent, they want the cascade to drain.
   * Triggers an immediate flush so the user sees activity. */
  async retry(entryId: number): Promise<void> {
    await db.syncQueue.update(entryId, {
      status: "pending",
      retries: 0,
      error: undefined,
      errorBody: undefined,
      errorStatus: undefined,
      failedAt: undefined,
      blockedBy: undefined,
      reported: undefined,
    });
    await unblockDependents(entryId);
    void syncEngine.flush();
  },

  /** Tombstone a failed / blocked entry (and, when `cascade` is true,
   * every entry blocked downstream of it). The row stays in syncQueue
   * with `status: "discarded"` so gates that scan the queue for a given
   * matchId / profileId — `useMatchSyncStatus` powers the Share button
   * gate — still see the local data as "never reached the server" and
   * keep the corresponding affordances disabled. Without this, Discard
   * would clear the queue, the Share button would re-enable, and the
   * user would get a 404 on a match the server has no record of.
   *
   * `clearReported` flips off the telemetry flag so a deliberate discard
   * doesn't leave the row carrying a stale "already reported" mark; the
   * row is now in a permanent state and reporter / banner alike skip it.
   *
   * Reversible via Retry, which flips the entry back to `pending`. */
  async discard(entryId: number, options: { cascade: boolean }): Promise<void> {
    const ids = options.cascade
      ? [entryId, ...(await collectDependentChain(entryId))]
      : [entryId];
    await db.transaction("rw", db.syncQueue, async () => {
      for (const id of ids) {
        await db.syncQueue.update(id, {
          status: "discarded",
          blockedBy: undefined,
          reported: true,
        });
      }
    });
  },

  /** Snapshot of every queue entry whose `blockedBy` points (transitively)
   * at the given parent. Used by the Settings panel to render the
   * "Discard will also drop N dependents" confirmation dialog without
   * the user needing to discover the cascade by inspection. */
  async dependentsOf(entryId: number): Promise<SyncQueueEntry[]> {
    const ids = await collectDependentChain(entryId);
    if (ids.length === 0) return [];
    const entries = await db.syncQueue.bulkGet(ids);
    return entries.filter((e): e is SyncQueueEntry => e !== undefined);
  },

  /** Reactive sync status for the global indicator banner.
   *
   * - `offline` overrides everything when the browser is offline.
   * - `saving` while any pending entry remains.
   * - `saved` for SAVED_LINGER_MS after the queue drains, then `idle`.
   *
   * Self-heals on stuck "saving": when `navigator.onLine` is true but
   * the queue isn't draining (e.g. user un-throttled DevTools without
   * the browser firing an `online` event because navigator.onLine never
   * transitioned), retry `flush()` every PENDING_RETRY_MS until the
   * queue drains. This is the safety net for cases the `online` event
   * doesn't cover — captive portal release, throttling toggle, VPN
   * reconnect.
   */
  useStatus(): SyncStatus {
    const { isOnline } = useOnlineStatus();
    // Scope the pill to the current user. The hook throws if the
    // session isn't ready, but `SyncStatus` only mounts inside the
    // `_authenticated` route guard so the invariant holds. The
    // live-query depends on viewerId so a user switch refreshes it.
    const viewerId = useRequiredViewerId();
    const pendingCount = useLiveQuery(
      async () => {
        const all = await db.syncQueue
          .where("status")
          .equals("pending")
          .toArray();
        // Inline the inference rather than calling filterOwnedBy so
        // useLiveQuery sees the .get reads on matches/profiles too —
        // alias edits / match deletes on a foreign user's data won't
        // shift our count, but pending-entries on our matches do.
        let count = 0;
        for (const entry of all) {
          const ownerId = await inferEntryOwnerId(entry);
          if (ownerId === viewerId) count += 1;
        }
        return count;
      },
      [viewerId],
      0,
    );
    const [savedUntil, setSavedUntil] = useState(0);
    const prevPending = useRef(pendingCount);

    useEffect(() => {
      // Transition from N>0 → 0: queue just drained. Show "saved" until
      // the linger window expires.
      if (prevPending.current > 0 && pendingCount === 0) {
        setSavedUntil(Date.now() + SAVED_LINGER_MS);
      }
      prevPending.current = pendingCount;
    }, [pendingCount]);

    const [, force] = useState(0);
    useEffect(() => {
      if (savedUntil === 0) return;
      const remaining = savedUntil - Date.now();
      if (remaining <= 0) return;
      const t = window.setTimeout(() => force((n) => n + 1), remaining);
      return () => window.clearTimeout(t);
    }, [savedUntil]);

    useEffect(() => {
      if (!isOnline || pendingCount === 0) return;
      // Fire once immediately on entering the "online + pending"
      // condition (covers the boot-after-offline-refresh case where the
      // online event never fired). The interval covers ongoing recovery
      // attempts as long as the queue stays non-empty.
      void syncEngine.flush();
      const id = window.setInterval(() => {
        void syncEngine.flush();
      }, PENDING_RETRY_MS);
      return () => window.clearInterval(id);
    }, [isOnline, pendingCount]);

    if (!isOnline) return "offline";
    if (pendingCount > 0) return "saving";
    if (savedUntil > Date.now()) return "saved";
    return "idle";
  },
};

/** Bump retry count and, on exhaustion, mark terminal + cascade-block
 * any later pending entries that depend on this one. Returns `true` if
 * the entry transitioned to `failed` this call — lets the flush loop
 * count it as progress (a status change that needs another pass to
 * spot any newly-unblocked work). */
async function incrementRetry(
  entry: SyncQueueEntry,
  res: Response,
): Promise<boolean> {
  const nextRetries = entry.retries + 1;
  if (nextRetries >= MAX_RETRIES) {
    const errorBody = await readStructuredErrorBody(res);
    await db.syncQueue.update(entry.id!, {
      retries: nextRetries,
      status: "failed",
      error: errorBody?.error ?? `Max retries reached`,
      errorBody: errorBody ?? undefined,
      errorStatus: res.status,
      failedAt: new Date().toISOString(),
    });
    await markCascadeBlocked({ ...entry, retries: nextRetries });
    return true;
  }
  await db.syncQueue.update(entry.id!, { retries: nextRetries });
  return false;
}

/** Mark an entry terminal failure and cascade-block its dependents.
 * Shared between the 4xx and auth-failure paths in flush(). */
async function markEntryFailed(
  entry: SyncQueueEntry,
  errorBody: SyncErrorBody | null,
  status: number,
): Promise<void> {
  await db.syncQueue.update(entry.id!, {
    status: "failed",
    error: errorBody?.error ?? `HTTP ${status}`,
    errorBody: errorBody ?? undefined,
    errorStatus: status,
    failedAt: new Date().toISOString(),
  });
  await markCascadeBlocked(entry);
}

/** Find every later `pending` entry whose URL / body references one of
 * the failed entry's client-supplied ids, and flip it to `blocked` with
 * `blockedBy` pointing back here. Only later-by-createdAt entries are
 * candidates: an earlier write that happened to share an id was clearly
 * not waiting on this one.
 *
 * Already-`failed` or already-`blocked` entries are left alone — their
 * own failure metadata is the more useful diagnostic. Only `pending`
 * candidates flip. */
async function markCascadeBlocked(parent: SyncQueueEntry): Promise<void> {
  if (parent.id === undefined) return;
  const parentIds = extractClientIds(parent);
  if (parentIds.length === 0) return;

  const candidates = await db.syncQueue
    .where("status")
    .equals("pending")
    .toArray();

  for (const candidate of candidates) {
    if (candidate.id === undefined) continue;
    if (candidate.createdAt <= parent.createdAt) continue;
    if (!entryReferencesAny(candidate, parentIds)) continue;
    await db.syncQueue.update(candidate.id, {
      status: "blocked",
      blockedBy: parent.id,
    });
  }
}

/** Flip every entry blocked by the given (now-resolved) parent back to
 * `pending`. Called after a successful drain in flush() and after Retry.
 *
 * Walks the chain transitively: if A blocks B and B blocks C, unblocking
 * A re-enables B and C. We don't trust `blockedBy` chains to be a tree —
 * it's possible (though unusual) for two parents to have blocked the
 * same dependent at different times, so the walk uses a visited set. */
async function unblockDependents(parentId: number): Promise<void> {
  const queue: number[] = [parentId];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const dependents = await db.syncQueue
      .where("status")
      .equals("blocked")
      .filter((e) => e.blockedBy === id)
      .toArray();
    for (const dep of dependents) {
      if (dep.id === undefined) continue;
      await db.syncQueue.update(dep.id, {
        status: "pending",
        blockedBy: undefined,
      });
      queue.push(dep.id);
    }
  }
}

/** Walk the dependent chain rooted at `parentId` (entries with
 * `blockedBy === parentId`, plus their own dependents, recursively).
 * Returns ids only — the caller decides whether to delete, snapshot,
 * or count them. */
async function collectDependentChain(parentId: number): Promise<number[]> {
  const result: number[] = [];
  const queue: number[] = [parentId];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const dependents = await db.syncQueue
      .filter((e) => e.blockedBy === id)
      .toArray();
    for (const dep of dependents) {
      if (dep.id === undefined) continue;
      result.push(dep.id);
      queue.push(dep.id);
    }
  }
  return result;
}

/** Read the response body as a `SyncErrorBody` if it looks like one. Returns
 * `null` for responses that aren't JSON or whose JSON doesn't carry the
 * expected `error` string — the caller falls back to a generic `HTTP N`
 * label in that case. */
async function readStructuredErrorBody(
  res: Response,
): Promise<SyncErrorBody | null> {
  try {
    const cloned = res.clone();
    const parsed = (await cloned.json()) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      return parsed as SyncErrorBody;
    }
  } catch {
    // not JSON, or stream already consumed — nothing structured to log.
  }
  return null;
}
