import { test, expect, type Page } from "@playwright/test";
import { readCurrentUserId } from "./helpers/auth";

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
  // The profile id here gets mirrored as a local Dexie row owned by
  // the current user — 8-F's ownership inferer reads that row to scope
  // the panel to "our" entries.
  profileId: "seedbadidfortest123456789",
  body: JSON.stringify({ id: "seedbadidfortest123456789", alias: "" }),
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
  // current Dexie schema version, so the object stores exist. We push
  // one row into `syncQueue`, mirror the corresponding local profile
  // row (so 8-F's ownership inferer attributes the entry to us), and
  // clear the banner ack.
  const currentUserId = await readCurrentUserId(page);
  await page.evaluate(
    async ({ seed, currentUserId }) => {
      const openDb = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = window.indexedDB.open("onboard");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const db = await openDb();

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ["syncQueue", "syncMeta", "profiles"],
          "readwrite",
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const now = new Date().toISOString();
        tx.objectStore("profiles").put({
          id: seed.profileId,
          ownerId: currentUserId,
          linkedUserId: null,
          alias: "Test Profile",
          customAvatarUrl: null,
          useLinkedAvatar: true,
          avatarFrame: "circle",
          avatarRing: null,
          usedAt: now,
          createdAt: now,
          updatedAt: now,
          linkedUser: null,
        });
        tx.objectStore("syncQueue").add({
          method: seed.method,
          url: seed.url,
          body: seed.body,
          createdAt: now,
          retries: 3,
          status: "failed",
          error: seed.errorBody.error,
          errorBody: seed.errorBody,
          errorStatus: seed.errorStatus,
          failedAt: now,
          reported: true, // suppress telemetry POST in tests
        });
        tx.objectStore("syncMeta").delete("failedBannerAcknowledgedAt");
      });

      db.close();
    },
    { seed: SEED_FAILED_ENTRY, currentUserId },
  );
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

  test("legacy failed entry (no failedAt) is dismissable via Settings", async ({
    page,
  }) => {
    // Reproduces the case that bit the maintainer on the deployed
    // preview: an entry that failed *before* Phase 8-E added the
    // `failedAt` instrumentation. Without the ack-honors-legacy fix in
    // the banner, `latestFailedAt === null` short-circuits to "always
    // show" and the user has no way to dismiss it.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");

    const currentUserId = await readCurrentUserId(page);
    await page.evaluate(async (currentUserId) => {
      const openDb = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = window.indexedDB.open("onboard");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ["syncQueue", "syncMeta", "profiles"],
          "readwrite",
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const now = new Date().toISOString();
        // Mirror the local profile row so 8-F's ownership inferer
        // attributes the queued entry to us — the pre-8-E shape of
        // the queue entry itself stays intact (no failedAt /
        // errorBody / errorStatus).
        tx.objectStore("profiles").put({
          id: "legacy",
          ownerId: currentUserId,
          linkedUserId: null,
          alias: "Legacy",
          customAvatarUrl: null,
          useLinkedAvatar: true,
          avatarFrame: "circle",
          avatarRing: null,
          usedAt: now,
          createdAt: now,
          updatedAt: now,
          linkedUser: null,
        });
        tx.objectStore("syncQueue").add({
          method: "POST",
          url: "/api/profiles",
          body: JSON.stringify({ id: "legacy", alias: "" }),
          createdAt: now,
          retries: 3,
          status: "failed",
          error: "Max retries reached",
          reported: true,
          // Intentional: no failedAt, no errorBody, no errorStatus —
          // mirrors the pre-8-E shape of failed rows on real devices.
        });
        tx.objectStore("syncMeta").delete("failedBannerAcknowledgedAt");
      });
      db.close();
    }, currentUserId);

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("sync-failed-banner")).toBeVisible();

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("settings-sync-panel")).toBeVisible();

    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("sync-failed-banner")).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("sync-failed-banner")).toHaveCount(0);
  });
});
