import { type Page } from "@playwright/test";

/**
 * Browser-side IndexedDB helpers for E2E specs that need to seed or
 * inspect the `onboard` Dexie store directly.
 *
 * The store is opened raw via `window.indexedDB` (not Dexie) because
 * the test runner doesn't bundle the Dexie API — by the time
 * `page.goto("/games")` returns, the app has already opened the
 * database at its current Dexie schema version, so the object stores
 * exist and can be read/written directly.
 */

/** Subset of the `syncQueue` row fields the sync E2E specs assert on.
 * Kept narrow so the helper doesn't have to mirror the full Dexie
 * shape — extend as new fields become relevant. */
export type SyncQueueRowSnapshot = {
  id: number;
  method?: string;
  url?: string;
  status: string;
  body?: string;
  blockedBy?: number;
};

/** Read every row from the `syncQueue` object store. Returns the rows
 * in insertion order (the order Dexie's autoIncrement assigned ids).
 * Use the returned snapshots to assert on status transitions,
 * blockedBy links, body contents, etc. */
export async function readSyncQueueRows(
  page: Page,
): Promise<SyncQueueRowSnapshot[]> {
  return page.evaluate(async () => {
    const openDb = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = window.indexedDB.open("onboard");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await openDb();
    const rows = await new Promise<
      {
        id: number;
        method?: string;
        url?: string;
        status: string;
        body?: string;
        blockedBy?: number;
      }[]
    >((resolve, reject) => {
      const tx = db.transaction("syncQueue", "readonly");
      const req = tx.objectStore("syncQueue").getAll();
      req.onsuccess = () =>
        resolve(
          req.result as {
            id: number;
            method?: string;
            url?: string;
            status: string;
            body?: string;
            blockedBy?: number;
          }[],
        );
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  });
}
