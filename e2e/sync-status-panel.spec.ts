import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 8-E — Sync queue visibility.
 *
 * Seeds a terminally-failed sync queue entry directly into Dexie and
 * asserts the diagnostic surface lights up: app-shell banner appears,
 * Settings → Sync panel renders the structured error verbatim, and
 * opening Settings acks the banner so it stays hidden on the next load.
 *
 * Seeding via `page.evaluate()` rather than driving a real 400 because
 * the panel is the unit under test here — the upstream
 * `flush() → mark-failed` path runs in production every time the
 * server returns 4xx and is exercised by the rest of the suite
 * incidentally. This spec is the focused surface check.
 */

const SEED_FAILED_ENTRY = {
  method: "POST",
  url: "/api/profiles",
  body: JSON.stringify({ id: "seed-bad-id-for-test", alias: "" }),
  errorBody: {
    error: "Alias is required",
    field: "alias",
    hint: "The profile alias was empty or missing when the create-profile POST replayed.",
  },
  errorStatus: 400,
};

async function seedFailedEntry(page: Page) {
  // Use raw IndexedDB rather than Dexie. By the time `page.goto('/games')`
  // returns, the app has already opened the `onboard` database at its
  // current Dexie schema version, so the object stores exist. We just
  // need to push one row into `syncQueue` and clear the banner ack.
  await page.evaluate(async (seed) => {
    const openDb = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = window.indexedDB.open("onboard");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await openDb();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["syncQueue", "syncMeta"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("syncQueue").add({
        method: seed.method,
        url: seed.url,
        body: seed.body,
        createdAt: new Date().toISOString(),
        retries: 3,
        status: "failed",
        error: seed.errorBody.error,
        errorBody: seed.errorBody,
        errorStatus: seed.errorStatus,
        failedAt: new Date().toISOString(),
        reported: true, // suppress telemetry POST in tests
      });
      tx.objectStore("syncMeta").delete("failedBannerAcknowledgedAt");
    });

    db.close();
  }, SEED_FAILED_ENTRY);
}

test.describe("Sync queue visibility (Phase 8-E)", () => {
  test("failed entry shows in Settings panel with structured error", async ({
    page,
  }) => {
    // Inherits the shared auth storageState from auth-setup.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");

    await seedFailedEntry(page);

    // Reload so the useLiveQuery subscriptions pick the new row up.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // App-shell banner is visible.
    await expect(page.getByTestId("sync-failed-banner")).toBeVisible();

    // Navigate to Settings — banner CTA is the canonical entry point.
    await page.getByTestId("sync-failed-banner-cta").click();
    await page.waitForURL(/\/settings$/);
    await page.waitForLoadState("domcontentloaded");

    // Sync panel renders with failed summary + entry list.
    await expect(page.getByTestId("settings-sync-panel")).toBeVisible();
    await expect(page.getByTestId("sync-summary-failed")).toContainText("1");

    const entry = page.getByTestId("sync-entry").first();
    await expect(entry).toBeVisible();
    await expect(entry).toContainText("POST");
    await expect(entry).toContainText("/api/profiles");
    await expect(entry).toContainText("HTTP 400");
    await expect(entry).toContainText("Alias is required");
    await expect(entry).toContainText("alias");
  });

  test("opening Settings acks the banner; it stays hidden on reload", async ({
    page,
  }) => {
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");

    await seedFailedEntry(page);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("sync-failed-banner")).toBeVisible();

    // Open Settings → SyncPanel's mount-effect writes the ack.
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("settings-sync-panel")).toBeVisible();

    // Navigate away and back — banner should stay hidden.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("sync-failed-banner")).toHaveCount(0);
  });
});
