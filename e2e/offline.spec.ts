import { test, expect } from "@playwright/test";

/**
 * Offline behavior — covers the gcTime: Infinity fix (prefetched queries
 * survive in the cache) and the offline-no-cache fallback UX.
 *
 * Chromium-only: Playwright's BrowserContext.setOffline uses CDP's
 * Network.emulateNetworkConditions, which is the same mechanism Chrome
 * DevTools' "Offline" throttle uses. Reliable on Chromium; less so on WebKit,
 * so we skip the Mobile Safari project.
 */
test.describe("Offline", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Playwright's CDP-based setOffline is chromium-only",
  );

  test.beforeEach(async ({ page }) => {
    // Wipe the persisted query cache so each test starts from a known empty
    // state and the per-game prefetch is forced to fire (otherwise prefetch
    // staleTime: 1h would skip it on a warm cache).
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => {
      localStorage.removeItem("onboard_query_cache");
    });
  });

  test("offline navigation to a prefetched game detail page renders cached data", async ({
    page,
    context,
  }) => {
    // Online: load the games list and wait for the per-game prefetches to
    // resolve. usePrefetchGames warms ['games', slug] and ['matches', {gameId}]
    // for every game returned by /api/games.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/games/7-wonders-duel") && r.ok(),
      ),
      page.waitForResponse(
        (r) => /\/api\/matches\?gameId=/.test(r.url()) && r.ok(),
      ),
      page.goto("/games"),
    ]);
    await expect(page.locator("h1")).toContainText("Games");

    // Drop the network. With gcTime: Infinity the prefetched entries must
    // still be in cache; with the previous 90-day gcTime they were GC'd
    // microseconds after success and the navigation below would render the
    // offline-no-cache fallback instead.
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

  test("offline match history is visible on the prefetched game detail page", async ({
    page,
    context,
  }) => {
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/games/7-wonders-duel") && r.ok(),
      ),
      page.waitForResponse(
        (r) => /\/api\/matches\?gameId=/.test(r.url()) && r.ok(),
      ),
      page.goto("/games"),
    ]);

    await context.setOffline(true);

    await page.click("text=7 Wonders Duel");
    await page.waitForURL("**/games/7-wonders-duel");

    // The match-history container is always rendered (with either rows or an
    // empty state); its presence proves the ['matches', {gameId}] query
    // resolved from cache rather than failing the network call.
    await expect(page.getByTestId("match-history")).toBeVisible();
  });

  test("offline navigation to an uncached game shows the offline-no-cache message", async ({
    page,
    context,
  }) => {
    // Force the per-game prefetch to fail so the games detail entry never
    // makes it into the cache. usePrefetchGames also prefetches matches; we
    // let those through so the page render is purely about the missing game
    // detail entry.
    //
    // We use in-app navigation (a click on the SPA Link) rather than
    // page.goto so this test works in dev mode too — the dev server doesn't
    // ship the service worker (vite-plugin-pwa devOptions.enabled = false),
    // so a hard offline navigation would fail at the document-request layer
    // before our React code ever mounts. The production build's SW handles
    // that case via navigateFallback; we cover the document-request path
    // through the manual validation plan instead.
    await context.route("**/api/games/7-wonders-duel", (route) =>
      route.abort("connectionfailed"),
    );

    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/games") && r.ok()),
      page.goto("/games"),
    ]);
    await expect(page.locator("h1")).toContainText("Games");

    await context.setOffline(true);

    await page.click("text=7 Wonders Duel");
    await page.waitForURL("**/games/7-wonders-duel");

    await expect(
      page.getByText("This page wasn't saved for offline use", {
        exact: false,
      }),
    ).toBeVisible();
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
    // Online load to populate `onboard_session_cache` from the live session.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Games");

    const cached = await page.evaluate(() =>
      localStorage.getItem("onboard_session_cache"),
    );
    expect(cached).not.toBeNull();

    // Fail get-session without flipping navigator.onLine. Pre-fix this drove
    // useAuthSession into the `session: null` branch — _authenticated then
    // bounced to "/". Post-fix the better-auth `error` triggers the cached
    // fallback regardless of `navigator.onLine`.
    await context.route("**/api/auth/get-session*", (route) =>
      route.abort("connectionfailed"),
    );

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page).toHaveURL(/\/games$/);
    await expect(page.locator("h1")).toContainText("Games");
  });
});
