import { onlineManager } from "@tanstack/react-query";
import { db, type SyncQueueEntry } from "./db";
import { queryClient } from "./query-client";

const MAX_RETRIES = 3;

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
   * After flushing, invalidates all TanStack Query caches so stale
   * optimistic data is replaced with fresh server state.
   */
  async flush(): Promise<void> {
    if (!onlineManager.isOnline()) return;

    const entries = await db.syncQueue
      .filter((e) => !e.error)
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
          // Auth error — no point retrying, mark as permanent error.
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
      // Invalidate all queries so fresh data replaces any optimistic state.
      await queryClient.invalidateQueries();
    }
  },
};

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
