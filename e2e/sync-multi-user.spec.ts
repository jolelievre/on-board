import { test, expect, type Page } from "@playwright/test";
import { readCurrentUserId } from "./helpers/auth";

/**
 * Phase 8-F — Multi-user sync queue scoping.
 *
 * IndexedDB is per-origin (per browser, per domain) — not per user.
 * When the same browser hosts more than one successive login (account
 * switch, shared family device, test/prod), every user's historical
 * Dexie data piles up in the same store. This spec exercises the
 * ownership inference path that scopes the Sync panel and flush()
 * replay to the current user only.
 *
 * Setup: we authenticate as the test user via the shared auth-setup,
 * then seed two local matches into Dexie — one owned by the current
 * user, one owned by a synthetic "foreign" user id. Each gets a
 * pending POST /api/matches queue entry. The current user's entry must
 * surface; the foreign one must be invisible AND must not be replayed
 * by flush(). Without the inference filter both rows would render
 * indistinguishably and the wrong account would attempt the foreign
 * mutation under its own session.
 */

const FOREIGN_USER_ID = "foreign-user-id-not-mine";
const MINE_MATCH_ID = "minematchidaaaaaaaaaaaaaa";
const FOREIGN_MATCH_ID = "foreignmatchidaaaaaaaaaaaa";

async function seedTwoUsersMatches(page: Page, currentUserId: string) {
  await page.evaluate(
    async ({ mineMatchId, foreignMatchId, mineUserId, foreignUserId }) => {
      const openDb = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = window.indexedDB.open("onboard");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const db = await openDb();

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["matches", "syncQueue"], "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);

        const matches = tx.objectStore("matches");
        const queue = tx.objectStore("syncQueue");
        const now = new Date().toISOString();

        // Mine — current user's match. The inference resolver will
        // read createdById off this row and match it against the
        // logged-in session.
        matches.put({
          id: mineMatchId,
          gameId: "skull-king",
          createdById: mineUserId,
          status: "IN_PROGRESS",
          victoryType: null,
          winnerId: null,
          metadata: {},
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        });
        queue.add({
          method: "POST",
          url: "/api/matches",
          body: JSON.stringify({
            id: mineMatchId,
            gameId: "skull-king",
            players: [],
          }),
          createdAt: new Date(Date.now() - 5000).toISOString(),
          retries: 0,
          status: "pending",
        });

        // Theirs — foreign user's match left behind from a prior
        // login on this same browser. createdById points at a user
        // we are not logged in as.
        matches.put({
          id: foreignMatchId,
          gameId: "skull-king",
          createdById: foreignUserId,
          status: "IN_PROGRESS",
          victoryType: null,
          winnerId: null,
          metadata: {},
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        });
        queue.add({
          method: "POST",
          url: "/api/matches",
          body: JSON.stringify({
            id: foreignMatchId,
            gameId: "skull-king",
            players: [],
          }),
          createdAt: new Date(Date.now() - 4000).toISOString(),
          retries: 0,
          status: "pending",
        });
      });

      db.close();
    },
    {
      mineMatchId: MINE_MATCH_ID,
      foreignMatchId: FOREIGN_MATCH_ID,
      mineUserId: currentUserId,
      foreignUserId: FOREIGN_USER_ID,
    },
  );
}

test.describe("Sync queue multi-user scoping (Phase 8-F)", () => {
  test("pre-fix match rows (no createdById) attribute via player.profile.ownerId fallback", async ({
    page,
  }) => {
    // Regression for the comment surfaced during PR review: every
    // Match row on a device whose queue was populated before this PR
    // has `createdById: undefined` locally (the field was previously
    // set server-side and only arrived via pull-sync). Without the
    // fallback in `inferEntryOwnerId`, those rows would be treated as
    // foreign and the entire stuck queue would become invisible on
    // the maintainer's mobile device after the v7 upgrade.
    //
    // The fallback resolves match ownership via `player.profile.
    // ownerId` for any player in the match: the creator owns every
    // profile referenced in their own match's players list, so the
    // ownerId is the creator by construction. This test seeds the
    // pre-fix shape verbatim and asserts the queued match POST still
    // surfaces.
    const PRE_FIX_MATCH_ID = "prefixmatchidaaaaaaaaaaaa";
    const PLAYER_PROFILE_ID = "prefixplayerprofileaaaaaa";

    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    const currentUserId = await readCurrentUserId(page);

    await page.route("**/api/**", (route) => route.fulfill({ status: 503 }));

    await page.evaluate(
      async ({ matchId, profileId, currentUserId }) => {
        const openDb = () =>
          new Promise<IDBDatabase>((resolve, reject) => {
            const req = window.indexedDB.open("onboard");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(
            ["matches", "players", "profiles", "syncQueue"],
            "readwrite",
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          const now = new Date().toISOString();

          // Pre-fix Match row: createdById deliberately omitted.
          tx.objectStore("matches").put({
            id: matchId,
            gameId: "skull-king",
            // no createdById
            status: "IN_PROGRESS",
            victoryType: null,
            winnerId: null,
            metadata: {},
            startedAt: now,
            completedAt: null,
            updatedAt: now,
          });

          // The owner-attribution fallback path: a profile owned by
          // the current user, embedded on a player row in the match.
          tx.objectStore("profiles").put({
            id: profileId,
            ownerId: currentUserId,
            linkedUserId: null,
            alias: "Pre-fix player",
            customAvatarUrl: null,
            useLinkedAvatar: true,
            avatarFrame: "circle",
            avatarRing: null,
            usedAt: now,
            createdAt: now,
            updatedAt: now,
            linkedUser: null,
          });
          tx.objectStore("players").put({
            id: "prefixplayer1234567890ab",
            matchId,
            profileId,
            profileLinkedUserId: null,
            position: 0,
            profile: {
              id: profileId,
              ownerId: currentUserId,
              linkedUserId: null,
              alias: "Pre-fix player",
              customAvatarUrl: null,
              useLinkedAvatar: true,
              avatarFrame: "circle",
              avatarRing: null,
              linkedUser: null,
            },
            updatedAt: now,
          });

          tx.objectStore("syncQueue").add({
            method: "POST",
            url: "/api/matches",
            body: JSON.stringify({
              id: matchId,
              gameId: "skull-king",
              players: [],
            }),
            createdAt: now,
            retries: 0,
            status: "pending",
          });
        });
        db.close();
      },
      {
        matchId: PRE_FIX_MATCH_ID,
        profileId: PLAYER_PROFILE_ID,
        currentUserId,
      },
    );

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("settings-sync-panel")).toBeVisible();

    // The entry surfaces despite the Match row's missing createdById —
    // the inferer falls back to player.profile.ownerId and resolves
    // it to the current user. Without the fallback this would render
    // an empty OK panel.
    const pendingList = page.getByTestId("sync-pending-list");
    await expect(pendingList).toBeVisible();
    await expect(pendingList.getByTestId("sync-entry")).toHaveCount(1);
  });

  test("foreign-user entries don't surface in the panel and don't replay on flush", async ({
    page,
  }) => {
    // Land authenticated first so the session cache is populated and
    // we can read our own user id back out of localStorage. From there
    // we seed the two-user fixture and reload to let the engine
    // initialise against the new state.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    const currentUserId = await readCurrentUserId(page);

    // Register the stub BEFORE seeding so the engine's auto-flush
    // (fired as soon as useStatus's live-query sees a non-zero owned
    // pending count) hits 503 instead of the real server. 503 lands
    // on the engine's retry branch, which leaves the entry `pending`
    // — keeping us in the state under test rather than letting the
    // seed drift into `failed` mid-test. Pull-sync calls also get
    // stubbed; their failures are silently swallowed by the engine.
    const apiHits: string[] = [];
    await page.route("**/api/**", async (route) => {
      apiHits.push(
        `${route.request().method()} ${new URL(route.request().url()).pathname}`,
      );
      await route.fulfill({ status: 503 });
    });

    await seedTwoUsersMatches(page, currentUserId);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("settings-sync-panel")).toBeVisible();

    // Exactly one entry surfaces — the current user's match POST.
    // The foreign-user POST is silently scoped out by the ownership
    // inference filter in the panel's useLiveQuery. URL alone can't
    // discriminate (both targets are `/api/matches` — the id lives
    // in the body), so we expand the body preview to confirm which
    // one rendered.
    const pendingList = page.getByTestId("sync-pending-list");
    await expect(pendingList).toBeVisible();
    const visibleEntries = pendingList.getByTestId("sync-entry");
    await expect(visibleEntries).toHaveCount(1);
    await visibleEntries
      .first()
      .getByTestId("sync-entry-body-toggle")
      .click();
    const body = visibleEntries.first().getByTestId("sync-entry-body");
    await expect(body).toContainText(MINE_MATCH_ID);
    await expect(body).not.toContainText(FOREIGN_MATCH_ID);

    // Wait briefly for any background flush to attempt (useStatus
    // fires one as soon as it sees a non-zero owned pending count).
    // We only assert that the foreign id never appears in the API
    // hit log — the engine must refuse to replay it under our session.
    await page.waitForTimeout(500);
    const sawForeignReplay = apiHits.some((line) =>
      line.includes(FOREIGN_MATCH_ID),
    );
    expect(sawForeignReplay).toBe(false);

    // The Dexie row for the foreign entry is intact and still
    // `pending` — preserved for if/when that user logs back in. We
    // never tombstone, retry, or otherwise touch entries we don't
    // own; they're inert from the current session's perspective.
    const foreignStatus = await page.evaluate(async (matchId) => {
      const openDb = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = window.indexedDB.open("onboard");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const db = await openDb();
      const rows = await new Promise<{ body?: string; status: string }[]>(
        (resolve, reject) => {
          const tx = db.transaction("syncQueue", "readonly");
          const req = tx.objectStore("syncQueue").getAll();
          req.onsuccess = () =>
            resolve(req.result as { body?: string; status: string }[]);
          req.onerror = () => reject(req.error);
        },
      );
      db.close();
      const foreign = rows.find(
        (r) => typeof r.body === "string" && r.body.includes(matchId),
      );
      return foreign?.status ?? null;
    }, FOREIGN_MATCH_ID);
    expect(foreignStatus).toBe("pending");
  });
});
