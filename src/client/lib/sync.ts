import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type SyncQueueEntry } from "./db";
import type { SyncErrorBody } from "../../shared/sync-errors";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

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

  /** Number of entries still pending in the queue. */
  async pendingCount(): Promise<number> {
    return db.syncQueue.where("status").equals("pending").count();
  },

  /**
   * Replay all queued mutations in creation order.
   * Successful entries are deleted; failed entries increment retry count.
   * Entries that exceed MAX_RETRIES are marked `status: "failed"`.
   *
   * After a successful flush, triggers `pullSync()` to merge any
   * cross-device updates back into Dexie.
   */
  async flush(): Promise<void> {
    if (!navigator.onLine) return;

    const entries = await db.syncQueue
      .where("status")
      .equals("pending")
      .sortBy("createdAt");

    let anySuccess = false;

    for (const entry of entries) {
      try {
        const res = await fetch(entry.url, {
          method: entry.method,
          headers: { "Content-Type": "application/json" },
          body: entry.body,
        });

        if (res.ok) {
          await db.syncQueue.delete(entry.id!);
          anySuccess = true;
        } else if (res.status === 401 || res.status === 403) {
          // Auth or ownership failure — replaying won't change the outcome.
          const errorBody = await readStructuredErrorBody(res);
          await db.syncQueue.update(entry.id!, {
            status: "failed",
            error: errorBody?.error ?? `HTTP ${res.status}`,
            errorBody: errorBody ?? undefined,
            errorStatus: res.status,
            failedAt: new Date().toISOString(),
          });
        } else if (res.status >= 400 && res.status < 500) {
          // Other 4xx (validation, conflict, not-found) — replays won't fix
          // these, so mark terminal immediately rather than burning the
          // retry budget. The server's structured body lets the Sync
          // panel render an actionable message for diagnosis (Phase 8-E).
          const errorBody = await readStructuredErrorBody(res);
          await db.syncQueue.update(entry.id!, {
            status: "failed",
            error: errorBody?.error ?? `HTTP ${res.status}`,
            errorBody: errorBody ?? undefined,
            errorStatus: res.status,
            failedAt: new Date().toISOString(),
          });
        } else {
          // 5xx — server-side glitch, retry per the budget.
          await incrementRetry(entry, res);
        }
      } catch {
        // Network error mid-flush — stop; will retry on next reconnect.
        break;
      }
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
    const pendingCount = useLiveQuery(
      () => db.syncQueue.where("status").equals("pending").count(),
      [],
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

async function incrementRetry(entry: SyncQueueEntry, res: Response) {
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
  } else {
    await db.syncQueue.update(entry.id!, { retries: nextRetries });
  }
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
