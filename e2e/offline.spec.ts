import { test, expect, type Page } from "@playwright/test";

/**
 * Serialize the offline file. Most tests here toggle network state at
 * the BrowserContext level and the cross-device test spawns two extra
 * contexts; running them in parallel pushes the dev server past its
 * throughput limit (waitForURL timeouts after the new-match submit
 * because pullSync + Vite chunks + auth fire-hose the single Node
 * process). The full-suite cost is ~2 min vs ~1 min parallel.
 */
test.describe.configure({ mode: "serial" });

/**
 * Offline behavior — covers the local-first refactor (PR B).
 *
 * After login, `usePullOnAuth` populates Dexie with games + matches from
 * the server. All UI reads come from Dexie via `useLiveQuery`, so once
 * Dexie has the rows the screens render offline. Mutations write to
 * Dexie + the sync queue locally and replay on reconnect; the server
 * accepts the client-generated CUIDs idempotently (PR A).
 *
 * Chromium-only: Playwright's BrowserContext.setOffline uses CDP's
 * Network.emulateNetworkConditions, which matches Chrome DevTools'
 * "Offline" throttle. Reliable on Chromium; less so on WebKit.
 */

/** Inline helpers — mirror the ones in seven-wonders.spec.ts. They're
 * duplicated rather than imported because cross-spec imports would
 * couple otherwise unrelated test files; the helpers are tiny and
 * stable.
 */
async function resolvePlayerId(page: Page, name: string): Promise<string> {
  return page
    .locator(`[data-testid^='score-grid-player-'] >> text=${name}`)
    .first()
    .evaluate((el) =>
      el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
    );
}

async function setScore(
  page: Page,
  playerId: string,
  category: string,
  value: number,
): Promise<void> {
  const input = page.locator(
    `[data-testid='score-input-${playerId}-${category}']`,
  );
  await input.fill(String(value));
  await input.blur();
}
test.describe("Offline (local-first)", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Playwright's CDP-based setOffline is chromium-only",
  );

  test.beforeEach(async ({ page }) => {
    // Wipe both the legacy persisted-cache key (pre-v2 clients may still
    // have it after rolling forward) and the Dexie database so each test
    // starts from a clean slate. addInitScript runs before any page
    // script so the v2 upgrader and pullSync rehydrate from scratch.
    await page.addInitScript(() => {
      localStorage.removeItem("onboard_query_cache");
      // Best-effort: synchronous delete with no completion handler — Dexie
      // re-opens on next access. The deletion is fire-and-forget; pullSync
      // populates the empty DB shortly after.
      indexedDB.deleteDatabase("onboard");
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  });

  test("offline navigation to a previously-pulled game renders from Dexie", async ({
    page,
    context,
  }) => {
    // Online: load /games and wait for pullSync to fetch both endpoints.
    // After both resolve, Dexie has the full games catalogue and the
    // user's matches.
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/games") && r.ok()),
      page.waitForResponse(
        (r) => /\/api\/matches(\?|$)/.test(r.url()) && r.ok(),
      ),
      page.goto("/games"),
    ]);
    await expect(page.locator("h1")).toContainText("Games");

    // Drop the network. Dexie still holds the games rows so the detail
    // page must render entirely from local storage.
    await context.setOffline(true);

    await page.click("text=7 Wonders Duel");
    await page.waitForURL("**/games/7-wonders-duel");

    await expect(page.locator("h1")).toContainText("7 Wonders Duel");
    await expect(page.getByTestId("new-match-button")).toBeVisible();
    await expect(
      page.getByText("This page wasn't saved for offline use", {
        exact: false,
      }),
    ).not.toBeVisible();
  });

  test("offline match history is visible on the game detail page", async ({
    page,
    context,
  }) => {
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/games") && r.ok()),
      page.waitForResponse(
        (r) => /\/api\/matches(\?|$)/.test(r.url()) && r.ok(),
      ),
      page.goto("/games"),
    ]);

    await context.setOffline(true);

    await page.click("text=7 Wonders Duel");
    await page.waitForURL("**/games/7-wonders-duel");

    await expect(page.getByTestId("match-history")).toBeVisible();
  });

  test("offline-created match persists, surfaces real CUID, and replays on reconnect", async ({
    page,
    context,
  }) => {
    // Warm Dexie with the games catalogue.
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/games") && r.ok()),
      page.waitForResponse(
        (r) => /\/api\/matches(\?|$)/.test(r.url()) && r.ok(),
      ),
      page.goto("/games"),
    ]);

    await context.setOffline(true);

    // Create a new match while offline — mutations.createMatch writes the
    // row + queues a POST to /api/matches with the client CUID.
    await page.click("text=7 Wonders Duel");
    await page.click('[data-testid="new-match-button"]');
    await page.waitForURL("**/games/7-wonders-duel/new");
    await page.fill('[data-testid="new-match-player-0"]', "Alice");
    await page.fill('[data-testid="new-match-player-1"]', "Bob");
    await page.click('[data-testid="new-match-submit"]');

    // The URL is the real CUID generated locally — never a "draft_…"
    // prefix (that mechanism was removed in PR B).
    await page.waitForURL(/\/matches\/[a-z][a-z0-9]{19,}$/);
    const matchUrl = page.url();
    const matchId = matchUrl.split("/").pop()!;
    expect(matchId).not.toMatch(/^draft_/);

    // Navigate away and back via SPA links to prove Dexie is the source
    // of truth: the match row + players survive a route unmount/remount
    // without a server hit. A hard `page.reload()` would also work
    // against a production build (service worker serves the document),
    // but the dev server doesn't ship the SW, so the document request
    // would fail with ERR_INTERNET_DISCONNECTED. SPA navigation never
    // touches the network for the document and exercises the same
    // local-first read path.
    //
    // BottomNav is hidden on /matches/:id, so leave via the Header back
    // link (points at /games/7-wonders-duel), then re-enter the match
    // through the match-history row.
    await page.click("header a[href='/games/7-wonders-duel']");
    await page.waitForURL("**/games/7-wonders-duel");
    await expect(
      page.locator(`[data-testid='match-history-row-${matchId}']`),
    ).toBeVisible();
    await page.click(`[data-testid='match-history-row-${matchId}']`);
    await expect(page).toHaveURL(matchUrl);

    // Reconnect: the sync queue flushes; pullSync runs after success.
    const matchPost = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith("/api/matches") &&
        r.ok(),
    );
    await context.setOffline(false);
    await matchPost;

    // Match must now exist on the server. Replaying the queued POST is
    // safe because PR A made the endpoint upsert on the client-supplied
    // id — a second replay returns 200 with the same row, never a dupe.
    const apiRes = await page.request.get(`/api/matches/${matchId}`);
    expect(apiRes.ok()).toBeTruthy();
    const apiMatch = (await apiRes.json()) as { id: string };
    expect(apiMatch.id).toBe(matchId);
  });

  test("full offline lifecycle: create → score → complete, all replay on reconnect", async ({
    page,
    context,
  }) => {
    // The full user journey: offline from before the match exists,
    // through scoring two categories, through completion. On reconnect
    // the queue replays POST → PATCH → PUT in order; each is
    // idempotent / upsert-safe on the server. Combined into one test
    // because the three operations form a single semantic unit (a
    // played-offline match) and exercising them separately would
    // require either pre-existing server state (fragile) or a more
    // complex setup with intermediate online windows. Keeping the
    // sequence intact also pins the queue's ordering contract — POST
    // before PATCH before PUT — without an explicit assertion.
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/games") && r.ok()),
      page.waitForResponse(
        (r) => /\/api\/matches(\?|$)/.test(r.url()) && r.ok(),
      ),
      page.goto("/games"),
    ]);

    await context.setOffline(true);

    await page.click("text=7 Wonders Duel");
    await page.click("[data-testid='new-match-button']");
    await page.waitForURL("**/games/7-wonders-duel/new");
    await page.fill("[data-testid='new-match-player-0']", "Alice");
    await page.fill("[data-testid='new-match-player-1']", "Bob");
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z][a-z0-9]{19,}$/);
    const matchId = page.url().split("/").pop()!;

    const p1Id = await resolvePlayerId(page, "Alice");
    const p2Id = await resolvePlayerId(page, "Bob");

    // Score one decisive category for each player so completion picks
    // a winner deterministically (not a draw). useLiveQuery surfaces
    // the values immediately from Dexie — no network involved.
    await setScore(page, p1Id, "civil", 12);
    await setScore(page, p2Id, "wonders", 4);
    await expect(
      page.locator(`[data-testid='score-grid-total-${p1Id}']`),
    ).toHaveText("12");
    await expect(
      page.locator(`[data-testid='score-grid-total-${p2Id}']`),
    ).toHaveText("4");

    // Complete the match offline — completeMatch sets status:
    // "COMPLETED" + winnerId locally and enqueues the PUT.
    await expect(page.locator("[data-testid='complete-match']")).toContainText(
      "Alice",
    );
    await page.click("[data-testid='complete-match']");
    await expect(page.locator("[data-testid='winner-banner']")).toContainText(
      "Alice",
    );
    await expect(
      page.locator(`[data-testid='score-input-${p1Id}-civil']`),
    ).toBeDisabled();

    // Reconnect — flush() drains the entire queue in createdAt order:
    // POST /api/matches → PATCH /scores → PUT /api/matches/:id. We
    // gate on the LAST one (the PUT) succeeding, which only happens
    // after the POST has landed (server-side ownership check).
    const completePut = page.waitForResponse(
      (r) =>
        /\/api\/matches\/[^/]+$/.test(r.url()) &&
        r.request().method() === "PUT" &&
        r.ok(),
      { timeout: 15_000 },
    );
    await context.setOffline(false);
    await completePut;

    // Server-side verification of all three mutations in one shot.
    const apiRes = await page.request.get(`/api/matches/${matchId}`);
    expect(apiRes.ok()).toBeTruthy();
    const apiMatch = (await apiRes.json()) as {
      status: string;
      winnerId: string | null;
      victoryType: string | null;
      completedAt: string | null;
      scores: { playerId: string; category: string; value: number }[];
    };
    expect(apiMatch.status).toBe("COMPLETED");
    expect(apiMatch.winnerId).toBe(p1Id);
    expect(apiMatch.completedAt).not.toBeNull();
    expect(apiMatch.victoryType).not.toBeNull();
    const civil = apiMatch.scores.find(
      (s) => s.playerId === p1Id && s.category === "civil",
    );
    const wonders = apiMatch.scores.find(
      (s) => s.playerId === p2Id && s.category === "wonders",
    );
    expect(civil?.value).toBe(12);
    expect(wonders?.value).toBe(4);
  });

  test("SyncStatus pill shows 'offline' while writes are queued and clears after reconnect", async ({
    page,
    context,
  }) => {
    // Idle state: indicator unmounts entirely. We assert count===0
    // rather than not-visible because the SyncStatus component returns
    // null when status==='idle', so it shouldn't be in the DOM at all.
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/games") && r.ok()),
      page.waitForResponse(
        (r) => /\/api\/matches(\?|$)/.test(r.url()) && r.ok(),
      ),
      page.goto("/games"),
    ]);
    await expect(page.locator("[data-testid='sync-status']")).toHaveCount(0);

    await context.setOffline(true);

    // Create a match offline → useStatus() flips to "offline" since
    // the engine is offline AND there's a pending queue entry.
    await page.click("text=7 Wonders Duel");
    await page.click("[data-testid='new-match-button']");
    await page.waitForURL("**/games/7-wonders-duel/new");
    await page.fill("[data-testid='new-match-player-0']", "Alice");
    await page.fill("[data-testid='new-match-player-1']", "Bob");
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z][a-z0-9]{19,}$/);

    // While offline + queued, the indicator must surface with the
    // "offline" state attribute. We deliberately don't assert on the
    // intermediate "saving" / "saved" transitions — saving is a
    // network blink and saved is a 1.2 s linger, both vulnerable to
    // CI clock jitter. The stable observable property is: pill exists
    // and reads "offline" while disconnected with pending work.
    await expect(
      page.locator("[data-testid='sync-status']"),
    ).toHaveAttribute("data-status", "offline", { timeout: 3000 });

    // Reconnect — flush drains, pullSync runs, useStatus() eventually
    // returns to "idle" and SyncStatus unmounts. The timeout window
    // generously covers the 1.2 s saved-linger plus the queue replay.
    await context.setOffline(false);
    await expect(page.locator("[data-testid='sync-status']")).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});

/**
 * Cross-device LWW merge — two independent BrowserContexts share the
 * same auth identity (same `storageState` file) but have completely
 * separate IndexedDB. This is the only way to exercise the actual
 * pull-sync.ts merge path (LWW on `updatedAt`, child-row prune) end-
 * to-end: a write in device A goes through the server, then device B
 * has to pull it down into its own Dexie via `usePullOnAuth` on boot.
 *
 * Distinguishes from "Cross-tab live updates" above: that test shares
 * one IndexedDB and exercises Dexie's BroadcastChannel reactivity.
 * This one exercises the network round-trip.
 */
test.describe("Cross-device LWW merge (independent Dexie)", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "BrowserContext.setOffline + CDP throttling is chromium-only",
  );

  test("match created on device A is pulled into device B on first boot", async ({
    browser,
  }) => {
    const contextA = await browser.newContext({
      storageState: "e2e/.auth/state.json",
    });
    const contextB = await browser.newContext({
      storageState: "e2e/.auth/state.json",
    });

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      // Each context starts with an empty IndexedDB. Without this wipe
      // a flake in a prior run could leave a non-empty Dexie that
      // makes "new match appears" trivially true.
      for (const p of [pageA, pageB]) {
        await p.addInitScript(() => {
          localStorage.removeItem("onboard_query_cache");
          indexedDB.deleteDatabase("onboard");
        });
      }

      // Device A: warm Dexie, then create a match via the offline-
      // then-reconnect pattern (same flow as the combined-lifecycle
      // test above). Creating offline + reconnecting goes through the
      // sync queue's POST replay rather than a bare scheduleFlush
      // chained off createMatch's resolution; under serial-test load
      // the chained variant has been observed to stall before URL
      // change, while the queue-replay path is reliable.
      await Promise.all([
        pageA.waitForResponse((r) => r.url().endsWith("/api/games") && r.ok()),
        pageA.waitForResponse(
          (r) => /\/api\/matches(\?|$)/.test(r.url()) && r.ok(),
        ),
        pageA.goto("/games"),
      ]);

      await contextA.setOffline(true);

      await pageA.click("text=7 Wonders Duel");
      await pageA.click("[data-testid='new-match-button']");
      await pageA.waitForURL("**/games/7-wonders-duel/new");
      await pageA.fill("[data-testid='new-match-player-0']", "Alice");
      await pageA.fill("[data-testid='new-match-player-1']", "Bob");
      await pageA.click("[data-testid='new-match-submit']");
      await pageA.waitForURL(/\/matches\/[a-z][a-z0-9]{19,}$/);
      const matchId = pageA.url().split("/").pop()!;

      // Bring A online — queued POST replays. Poll for the match on the
      // server (rather than waitForResponse with `r.ok()`) so we absorb
      // the pre-existing TOCTOU on POST /api/matches where the first
      // attempt may return 500 and the second hits the idempotent path.
      await contextA.setOffline(false);
      await expect
        .poll(
          async () => {
            const res = await pageA.request.get(`/api/matches/${matchId}`);
            return res.status();
          },
          { timeout: 15_000, intervals: [300, 700, 1200, 2000] },
        )
        .toBe(200);

      // Device B: boot for the first time. usePullOnAuth fires once
      // when the session resolves; pullSync pulls /api/matches into B's
      // Dexie. useLiveQuery then surfaces the new match in the history.
      await Promise.all([
        pageB.waitForResponse(
          (r) => /\/api\/matches(\?|$)/.test(r.url()) && r.ok(),
        ),
        pageB.goto("/games/7-wonders-duel"),
      ]);

      await expect(
        pageB.locator(`[data-testid='match-history-row-${matchId}']`),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

/**
 * Cross-tab live updates — pins the useLiveQuery + Dexie reactivity contract.
 *
 * Same browser context => same IndexedDB. Dexie's BroadcastChannel-based
 * change notifier reaches every tab on the origin, so a write in tab A
 * must rerender any useLiveQuery subscriber in tab B without a manual
 * pull or reload. If this ever fails, our entire local-first read model
 * is broken — every screen would silently lag until the next pullSync.
 */
test.describe("Cross-tab live updates", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Cross-tab IndexedDB reactivity is consistent on Chromium; webkit is flakier",
  );

  test("a match created in tab A appears in tab B's history without reload", async ({
    context,
  }) => {
    const tabA = await context.newPage();
    await tabA.addInitScript(() => {
      localStorage.removeItem("onboard_query_cache");
      indexedDB.deleteDatabase("onboard");
    });

    // Tab A: wait for the initial pullSync so Dexie has the games row.
    await Promise.all([
      tabA.waitForResponse((r) => r.url().endsWith("/api/games") && r.ok()),
      tabA.waitForResponse(
        (r) => /\/api\/matches(\?|$)/.test(r.url()) && r.ok(),
      ),
      tabA.goto("/games/7-wonders-duel"),
    ]);
    await expect(tabA.locator("h1")).toContainText("7 Wonders Duel");

    const tabB = await context.newPage();
    await Promise.all([
      tabB.waitForResponse(
        (r) => /\/api\/matches(\?|$)/.test(r.url()) && r.ok(),
      ),
      tabB.goto("/games/7-wonders-duel"),
    ]);
    await expect(tabB.locator("h1")).toContainText("7 Wonders Duel");

    // Tab A: create a new match. mutations.createMatch writes the row
    // to the shared IndexedDB; BroadcastChannel notifies tab B's
    // useLiveQuery subscribers.
    await tabA.click("[data-testid='new-match-button']");
    await tabA.waitForURL("**/games/7-wonders-duel/new");
    await tabA.fill("[data-testid='new-match-player-0']", "TabA-P1");
    await tabA.fill("[data-testid='new-match-player-1']", "TabA-P2");
    await tabA.click("[data-testid='new-match-submit']");
    await tabA.waitForURL(/\/matches\/[a-z][a-z0-9]{19,}$/);
    const newMatchId = tabA.url().split("/").pop()!;

    // Tab B: the new match row appears in the history list reactively.
    // No goto, no reload — useLiveQuery must rerender on its own.
    await expect(
      tabB.locator(`[data-testid='match-history-row-${newMatchId}']`),
    ).toBeVisible({ timeout: 5000 });
  });
});

/**
 * Auth-session fallback regression — pins useAuthSession's error-driven
 * branch. Distinct from the BrowserContext.setOffline tests above because the
 * bug it covers shows up specifically when network requests fail while
 * `navigator.onLine` stays true (Chrome DevTools Network "Offline" throttle,
 * captive portals, VPN drops). We reproduce that condition by aborting only
 * /api/auth/get-session — no setOffline, so this runs on Mobile Safari too.
 */
test.describe("Auth session error-driven fallback", () => {
  test("aborted get-session keeps the user on /games when a cached session exists", async ({
    page,
    context,
  }) => {
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Games");

    const cached = await page.evaluate(() =>
      localStorage.getItem("onboard_session_cache"),
    );
    expect(cached).not.toBeNull();

    await context.route("**/api/auth/get-session*", (route) =>
      route.abort("connectionfailed"),
    );

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page).toHaveURL(/\/games$/);
    await expect(page.locator("h1")).toContainText("Games");
  });
});
