import { test, expect, type Page } from "@playwright/test";
import { readCurrentUserId } from "./helpers/auth";
import { readSyncQueueRows } from "./helpers/dexie";

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
    // section at the bottom, expandable. The discarded section mirrors
    // the failed-cascade UX — one parent card per root, dependents
    // collapsed under a "+N related changes" toggle. This is the gate
    // that keeps the Share button disabled for matches whose
    // create-POST was discarded.
    const discardedSection = page.getByTestId("sync-discarded-section");
    await expect(discardedSection).toBeVisible();
    await page.getByTestId("sync-discarded-toggle").click();

    // Exactly one discarded group renders (the discarded root). Its
    // parent row carries the Discarded badge; dependents are
    // collapsed under a "+N related" toggle that the user expands
    // on demand.
    const discardedList = page.getByTestId("sync-discarded-list");
    const discardedGroups = discardedList.getByTestId("sync-failure-group");
    await expect(discardedGroups).toHaveCount(1);
    await expect(
      discardedGroups.first().getByTestId("sync-entry-discarded-badge"),
    ).toHaveCount(1);
    const discardedToggle = discardedGroups
      .first()
      .getByTestId("sync-group-related-toggle");
    await expect(discardedToggle).toContainText("2");

    await discardedToggle.click();
    const allDiscardedBadges = page.getByTestId("sync-entry-discarded-badge");
    await expect(allDiscardedBadges).toHaveCount(3);

    // Confirm the raw Dexie state: 3 rows, all `discarded`. The two
    // dependents must retain `blockedBy` pointing at the parent so a
    // future Retry on the parent can find them and un-discard them
    // (without that link, a 30-entry cascade discard would require
    // 30 individual Retry clicks to undo).
    const rows = await readSyncQueueRows(page);
    expect(rows.map((r) => r.status).sort()).toEqual([
      "discarded",
      "discarded",
      "discarded",
    ]);
    const parent = rows.find(
      (r) => r.body !== undefined && r.body.includes(PARENT_PROFILE_ID),
    );
    expect(parent).toBeDefined();
    const dependentsWithLink = rows.filter(
      (r) => r.blockedBy === parent!.id,
    );
    expect(dependentsWithLink).toHaveLength(2);
  });

  test("retry on a discarded parent un-discards the cascade dependents back to blocked", async ({
    page,
  }) => {
    // The full undo flow: user discards a cascade (parent + 2
    // dependents tombstoned), changes their mind, clicks Retry on
    // the parent. Parent flips to `pending`; dependents flip back
    // to `blocked` (preserving blockedBy) and drain naturally if
    // the parent succeeds.
    //
    // Stub /api so the parent doesn't actually replay during the
    // assertion window — 503 keeps it `pending` after the engine
    // picks it up, letting us read a clean Dexie state.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await seedCascadedQueue(page);

    await page.route("**/api/**", (route) => route.fulfill({ status: 503 }));
    await gotoSyncPanel(page);

    // Discard the cascade first.
    const failedRow = page
      .getByTestId("sync-entry")
      .filter({ hasText: "/api/profiles" })
      .first();
    await failedRow.getByTestId("sync-entry-discard").click();
    await page.getByTestId("sync-discard-confirm").click();
    await expect(page.getByTestId("sync-summary-ok")).toBeVisible();

    // Open the Discarded section and click Retry on the parent.
    await page.getByTestId("sync-discarded-toggle").click();
    const discardedParent = page
      .getByTestId("sync-discarded-section")
      .getByTestId("sync-entry")
      .filter({ hasText: "/api/profiles" })
      .first();
    await discardedParent.getByTestId("sync-entry-retry").click();

    // Final state, read from Dexie: parent pending, 2 dependents
    // blocked (with blockedBy still pointing at the parent), zero
    // discarded. The active list shows the failure group again with
    // a +2 related toggle.
    await expect
      .poll(async () => {
        const rows = await readSyncQueueRows(page);
        return rows.map((r) => r.status).sort();
      })
      .toEqual(["blocked", "blocked", "pending"]);

    const rows = await readSyncQueueRows(page);
    const parent = rows.find((r) => r.status === "pending");
    expect(parent).toBeDefined();
    const blockedDeps = rows.filter((r) => r.status === "blocked");
    expect(blockedDeps).toHaveLength(2);
    for (const dep of blockedDeps) {
      expect(dep.blockedBy).toBe(parent!.id);
    }
  });

  test("retry on a failed parent re-queues it; dependents stay blocked until the parent actually drains", async ({
    page,
  }) => {
    // The full happy path (parent succeeds → blocked dependents flip
    // to pending in the same flush pass) needs a real round-trip. We
    // assert the *engine contract* here: Retry on a failed parent only
    // re-queues that single entry. Blocked dependents stay blocked
    // because nothing has landed server-side yet — flipping them to
    // pending speculatively would have them re-fail (parent hasn't
    // successfully created the upstream resource) and re-fall through
    // the cascade marker on the next pass. The flush success path
    // (`unblockDependents`) is the *only* legitimate trigger to flip
    // them; covered by the suite's natural drains.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await seedCascadedQueue(page);
    await gotoSyncPanel(page);

    // Stub every endpoint the engine might hit during a flush so the
    // parent can't actually drain: 503 increments the retry counter
    // but leaves status=`pending` (until MAX_RETRIES, which we won't
    // reach in one flush pass). Pulls + telemetry POSTs are also
    // intercepted so the live-query interval doesn't churn other
    // rows during the assertion window.
    await page.route("**/api/**", (route) => route.fulfill({ status: 503 }));

    const failedRow = page
      .getByTestId("sync-entry")
      .filter({ hasText: "/api/profiles" })
      .first();
    await failedRow.getByTestId("sync-entry-retry").click();

    await expect
      .poll(async () => {
        const rows = await readSyncQueueRows(page);
        return rows.map((r) => r.status).sort();
      })
      .toEqual(["blocked", "blocked", "pending"]);
  });
});
