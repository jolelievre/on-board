import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 8-F — Sync queue recovery.
 *
 * Drives the Settings → Sync panel's new Retry / Discard surface and
 * the cascading-failure semantics behind it. Seeds a parent failure +
 * two cascade-blocked dependents via IndexedDB so the UI starts in
 * the exact state PR 8-F is designed to drain.
 *
 * Why direct Dexie seeding: the engine path that produces this state
 * (replay → mark-failed → cascade-block) is exercised by the rest of
 * the suite incidentally. The unit under test here is the panel's
 * recovery affordances + the engine's Retry / Discard / auto-unblock
 * actions in response, which require a deterministic starting state.
 */

const PARENT_PROFILE_ID = "seedparentprofileabc1234";
const CHILD_MATCH_ID = "seedchildmatchidxyz9876543";

async function readCurrentUserId(page: Page): Promise<string> {
  // useAuthSession writes the session cache in a useEffect that runs
  // after first render — `domcontentloaded` can land before that
  // effect, so poll until the cache materialises rather than reading
  // synchronously.
  await page.waitForFunction(
    () => localStorage.getItem("onboard_session_cache") !== null,
    null,
    { timeout: 10_000 },
  );
  const id = await page.evaluate(() => {
    const raw = localStorage.getItem("onboard_session_cache");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { user?: { id?: string } };
      return parsed.user?.id ?? null;
    } catch {
      return null;
    }
  });
  expect(id, "auth-setup must populate the session cache").not.toBeNull();
  return id!;
}

async function seedCascadedQueue(page: Page) {
  // 8-F scopes the panel + replay to entries owned by the current
  // user. Seed the local profile + match rows the queue entries point
  // at so the ownership inferer resolves them back to us — without
  // them the panel filters everything out as foreign-user noise.
  const currentUserId = await readCurrentUserId(page);

  await page.evaluate(
    async ({ parentProfileId, childMatchId, currentUserId }) => {
      const openDb = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = window.indexedDB.open("onboard");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const db = await openDb();

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ["syncQueue", "syncMeta", "matches", "profiles"],
          "readwrite",
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);

        const queue = tx.objectStore("syncQueue");
        const now = new Date().toISOString();

        // Local profile row owned by the current user — anchors the
        // POST /api/profiles entry below to *us* for the ownership
        // inferer.
        tx.objectStore("profiles").put({
          id: parentProfileId,
          ownerId: currentUserId,
          linkedUserId: null,
          alias: "Cascade Test",
          customAvatarUrl: null,
          useLinkedAvatar: true,
          avatarFrame: "circle",
          avatarRing: null,
          usedAt: now,
          createdAt: now,
          updatedAt: now,
          linkedUser: null,
        });
        // Local match row owned by the current user — anchors every
        // /api/matches/<childMatchId>... entry to us.
        tx.objectStore("matches").put({
          id: childMatchId,
          gameId: "skull-king",
          createdById: currentUserId,
          status: "IN_PROGRESS",
          victoryType: null,
          winnerId: null,
          metadata: {},
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        });

        // Parent: a profile-create that the server refused. Without
        // this row landing, the match below references a profileId
        // that doesn't exist server-side.
        const parentAddReq = queue.add({
          method: "POST",
          url: "/api/profiles",
          body: JSON.stringify({ id: parentProfileId, alias: "Cascade Test" }),
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          retries: 3,
          status: "failed",
          error: "Alias is required",
          errorBody: {
            error: "Alias is required",
            field: "alias",
            hint: "Server-side validation rejected the profile create.",
          },
          errorStatus: 400,
          failedAt: new Date(Date.now() - 50_000).toISOString(),
          reported: true,
        });

        parentAddReq.onsuccess = () => {
          const parentId = parentAddReq.result as number;

          // Two dependents already cascade-blocked, pointing at the
          // parent. In production these get flipped from `pending` to
          // `blocked` by the engine's markCascadeBlocked() call; here
          // we seed them in the post-marker state so the test starts
          // exactly at the UI surface 8-F is responsible for.
          queue.add({
            method: "POST",
            url: "/api/matches",
            body: JSON.stringify({
              id: childMatchId,
              gameId: "skull-king",
              players: [
                { id: "seedplayerone111", position: 0, profileId: parentProfileId },
              ],
            }),
            createdAt: new Date(Date.now() - 40_000).toISOString(),
            retries: 0,
            status: "blocked",
            blockedBy: parentId,
          });

          queue.add({
            method: "PATCH",
            url: `/api/matches/${childMatchId}/scores`,
            body: JSON.stringify({
              scores: [
                { playerId: "seedplayerone111", category: "round-1", value: 20 },
              ],
            }),
            createdAt: new Date(Date.now() - 30_000).toISOString(),
            retries: 0,
            status: "blocked",
            blockedBy: parentId,
          });
        };

        tx.objectStore("syncMeta").delete("failedBannerAcknowledgedAt");
      });

      db.close();
    },
    {
      parentProfileId: PARENT_PROFILE_ID,
      childMatchId: CHILD_MATCH_ID,
      currentUserId,
    },
  );
}

async function gotoSyncPanel(page: Page) {
  await page.goto("/settings");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("settings-sync-panel")).toBeVisible();
}

test.describe("Sync queue recovery (Phase 8-F)", () => {
  test("failed parent renders as a group card; dependents are collapsed by default and reachable via the toggle", async ({
    page,
  }) => {
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");

    await seedCascadedQueue(page);

    await gotoSyncPanel(page);

    await expect(page.getByTestId("sync-summary-failed")).toContainText("1");
    await expect(page.getByTestId("sync-summary-blocked")).toContainText("2");

    // Exactly one failure-group card; only the parent row is visible
    // up front (dependents stay hidden until the user expands the
    // toggle), so the panel shows one entry instead of three even
    // though the queue carries 3 rows.
    const groups = page.getByTestId("sync-failure-group");
    await expect(groups).toHaveCount(1);
    const group = groups.first();
    await expect(group).toContainText("POST /api/profiles");
    await expect(group).toContainText("HTTP 400");
    await expect(group).toContainText("Alias is required");
    await expect(group.getByTestId("sync-entry-retry")).toBeVisible();
    await expect(group.getByTestId("sync-entry-discard")).toBeVisible();

    // The toggle advertises the cascade count without expanding it —
    // the user sees "2 related changes" rather than 2 extra rows.
    const toggle = group.getByTestId("sync-group-related-toggle");
    await expect(toggle).toContainText("2");
    await expect(page.getByTestId("sync-group-dependents")).toHaveCount(0);

    // Expanding renders both blocked rows under the parent. They
    // carry the Blocked badge and intentionally have no Retry /
    // Discard buttons of their own — recovery is owned by the parent.
    await toggle.click();
    const dependents = page.getByTestId("sync-group-dependents").getByTestId("sync-entry");
    await expect(dependents).toHaveCount(2);
    const blockedBadges = page.getByTestId("sync-entry-blocked-badge");
    await expect(blockedBadges).toHaveCount(2);
    await expect(dependents.getByTestId("sync-entry-retry")).toHaveCount(0);
    await expect(dependents.getByTestId("sync-entry-discard")).toHaveCount(0);
  });

  test("body toggle reveals the pretty-printed JSON body", async ({ page }) => {
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await seedCascadedQueue(page);
    await gotoSyncPanel(page);

    const failedRow = page
      .getByTestId("sync-entry")
      .filter({ hasText: "/api/profiles" })
      .first();
    await failedRow.getByTestId("sync-entry-body-toggle").click();

    const body = failedRow.getByTestId("sync-entry-body");
    await expect(body).toBeVisible();
    await expect(body).toContainText("Cascade Test");
    await expect(body).toContainText(PARENT_PROFILE_ID);
  });

  test("discard on the parent surfaces a confirm dialog listing dependents, then tombstones the cascade", async ({
    page,
  }) => {
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await seedCascadedQueue(page);
    await gotoSyncPanel(page);

    const failedRow = page
      .getByTestId("sync-entry")
      .filter({ hasText: "/api/profiles" })
      .first();
    await failedRow.getByTestId("sync-entry-discard").click();

    const dialog = page.getByTestId("sync-discard-dialog");
    await expect(dialog).toBeVisible();
    // The dialog must enumerate the dependents — without that, the
    // user can't see what they're about to drop.
    const dependentList = page.getByTestId("sync-discard-dependent-list");
    await expect(dependentList).toContainText("POST /api/matches");
    await expect(dependentList).toContainText(
      `PATCH /api/matches/${CHILD_MATCH_ID}/scores`,
    );

    await page.getByTestId("sync-discard-confirm").click();

    // The main list empties — the failed / blocked rows are gone from
    // the active view, so the OK summary shows.
    await expect(page.getByTestId("sync-summary-ok")).toBeVisible();
    await expect(page.getByTestId("sync-entry")).toHaveCount(0);

    // BUT the rows still exist as discarded tombstones: collapsed
    // section at the bottom, expandable, badges the local-only state.
    // This is the gate that keeps the Share button disabled for
    // matches whose create-POST was discarded.
    const discardedSection = page.getByTestId("sync-discarded-section");
    await expect(discardedSection).toBeVisible();
    await page.getByTestId("sync-discarded-toggle").click();
    const discardedBadges = page.getByTestId("sync-entry-discarded-badge");
    await expect(discardedBadges).toHaveCount(3);

    // Confirm the raw Dexie state: 3 rows, all `discarded`.
    const statuses = await page.evaluate(async () => {
      const openDb = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = window.indexedDB.open("onboard");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const db = await openDb();
      const rows = await new Promise<{ status: string }[]>(
        (resolve, reject) => {
          const tx = db.transaction("syncQueue", "readonly");
          const req = tx.objectStore("syncQueue").getAll();
          req.onsuccess = () => resolve(req.result as { status: string }[]);
          req.onerror = () => reject(req.error);
        },
      );
      db.close();
      return rows.map((r) => r.status).sort();
    });
    expect(statuses).toEqual(["discarded", "discarded", "discarded"]);
  });

  test("retry on the parent unblocks dependents (verified at the Dexie level)", async ({
    page,
  }) => {
    // The full happy path — parent succeeds → dependents drain — would
    // require a real network round-trip. We assert the engine-level
    // contract instead: clicking Retry flips the parent to `pending`
    // and unblocks its dependents back to `pending` so the next flush
    // pass picks them up. The flush itself is exercised by the rest
    // of the suite.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await seedCascadedQueue(page);
    await gotoSyncPanel(page);

    // Stub every endpoint the engine might hit during a flush so it
    // can't re-fail anything: 503 lands on the 5xx branch, which
    // increments the retry counter but leaves status=`pending`
    // (until MAX_RETRIES, which we won't reach in one flush pass).
    // Pulls + telemetry POSTs are also intercepted so the live-query
    // interval doesn't churn other rows during the assertion window.
    await page.route("**/api/**", (route) => route.fulfill({ status: 503 }));

    const failedRow = page
      .getByTestId("sync-entry")
      .filter({ hasText: "/api/profiles" })
      .first();
    await failedRow.getByTestId("sync-entry-retry").click();

    // Poll Dexie until the unblock landed. The UI re-render is
    // incidental here — the contract is "Retry flips status across
    // the cascade".
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const openDb = () =>
            new Promise<IDBDatabase>((resolve, reject) => {
              const req = window.indexedDB.open("onboard");
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
          const db = await openDb();
          const rows = await new Promise<{ status: string }[]>(
            (resolve, reject) => {
              const tx = db.transaction("syncQueue", "readonly");
              const req = tx.objectStore("syncQueue").getAll();
              req.onsuccess = () =>
                resolve(req.result as { status: string }[]);
              req.onerror = () => reject(req.error);
            },
          );
          db.close();
          return rows.map((r) => r.status).sort();
        }),
      )
      .toEqual(["pending", "pending", "pending"]);
  });
});
