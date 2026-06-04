import { db } from "./db";
import { requireCachedUserId } from "../hooks/useAuthSession";
import { filterOwnedBy } from "./sync-ownership";

/** Phase 8-E telemetry: post every newly-failed sync queue entry to
 * `/api/sync/failures` so we get a server-side trail of stuck states
 * across all users — diagnostic data for PR 8-F's recovery fix.
 *
 * Best-effort: a network error swallows the report (the entries stay
 * marked `failed`, just unreported), no UI surface. Each entry is
 * reported at most once — the `reported` flag flips after a successful
 * POST so a recurring pull-sync doesn't re-spam the server.
 *
 * Called from `pullSync()` after each pull lands. Pull-sync already
 * has the `navigator.onLine` guard, but we re-check here so a direct
 * caller (tests, dev tooling) gets the same short-circuit.
 *
 * Multi-user safety (PR 8-F): only failures belonging to the currently
 * logged-in user are reported. The server stamps `userId` from the
 * session, so reporting a foreign-user's failure under the wrong
 * session would attribute it to the wrong account in `SyncFailureLog`.
 * Foreign-user entries stay unreported until that user logs back in.
 */
export async function reportSyncFailures(): Promise<void> {
  if (!navigator.onLine) return;

  const currentUserId = requireCachedUserId();

  const allUnreported = await db.syncQueue
    .where("status")
    .equals("failed")
    .filter((entry) => entry.reported !== true)
    .toArray();

  const unreported = await filterOwnedBy(allUnreported, currentUserId);

  if (unreported.length === 0) return;

  const payload = {
    failures: unreported.map((entry) => ({
      method: entry.method,
      url: redactQueryString(entry.url),
      status: entry.errorStatus,
      errorMessage: entry.errorBody?.error ?? entry.error,
      errorField: entry.errorBody?.field,
      errorHint: entry.errorBody?.hint,
      retries: entry.retries,
      clientFailedAt: entry.failedAt,
    })),
  };

  try {
    const res = await fetch("/api/sync/failures", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
  } catch {
    return;
  }

  // Mark every reported row so the next pull-sync doesn't re-post it.
  // Each entry gets its own `update` rather than a bulk write because
  // the queue is tiny in practice (a stuck profile-create plus its
  // dependents) and per-id updates can't accidentally clobber an
  // intervening Retry / Discard action introduced in 8-F.
  await db.transaction("rw", db.syncQueue, async () => {
    for (const entry of unreported) {
      if (entry.id !== undefined) {
        await db.syncQueue.update(entry.id, { reported: true });
      }
    }
  });
}

/** Strip the query string from a queued URL before it leaves the device.
 * The queue holds full URLs including `?since=...` cursors; the panel
 * needs the path for grouping, and stripping the query keeps any
 * future debug param from accidentally reaching the telemetry table. */
function redactQueryString(url: string): string {
  const queryAt = url.indexOf("?");
  return queryAt === -1 ? url : url.slice(0, queryAt);
}
