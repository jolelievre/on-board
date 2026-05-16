import { test, expect } from "@playwright/test";

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
    await page.click("nav[aria-label='Primary'] a[href='/games']");
    await page.waitForURL("**/games");
    await page.click("a[href='/games/7-wonders-duel']");
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
