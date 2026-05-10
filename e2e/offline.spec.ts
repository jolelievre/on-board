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

  test("auth session is mirrored to localStorage so a cold offline load can authenticate", async ({
    page,
  }) => {
    // useAuthSession persists `{ user: { id, name, email, image } }` under
    // `onboard_session_cache`. The _authenticated layout reads it when
    // navigator.onLine is false and the live get-session call fails —
    // without that cache, a cold offline load would bounce the user back
    // to "/". We can't drive the cold-load path itself in dev mode (no
    // service worker, document fetch fails outright; the same caveat
    // documented on the offline-no-cache test above), so instead we pin
    // the precondition that makes the cold-load path work. A refactor that
    // stops persisting the session would break offline launch silently;
    // this assertion catches it.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Games");

    const raw = await page.evaluate(() =>
      localStorage.getItem("onboard_session_cache"),
    );
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      user?: { id?: string; email?: string };
    };
    expect(parsed?.user?.id).toBeTruthy();
    expect(parsed?.user?.email).toBeTruthy();
  });

  test("offline new-match form synthesizes the self suggestion chip from the cached session", async ({
    page,
    context,
  }) => {
    // Online: visit /games so usePrefetchGames warms ['games', '7-wonders-duel']
    // — without it, the new-match page would stall on the game-detail loader
    // when offline. We deliberately do NOT pre-fetch the suggestions endpoint
    // here: the test exercises the path where /api/players/suggestions is
    // unreachable and usePlayerSuggestions falls back to the synthesized
    // self entry derived from the auth session.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/games/7-wonders-duel") && r.ok(),
      ),
      page.goto("/games"),
    ]);

    await context.setOffline(true);

    await page.click("text=7 Wonders Duel");
    await page.waitForURL("**/games/7-wonders-duel");
    await page.click("[data-testid='new-match-button']");
    await page.waitForURL("**/games/7-wonders-duel/new");

    await page.click("[data-testid='new-match-player-0']");

    // At least one suggestion must render — the synthesized self chip from
    // session.user.alias || session.user.name. The exact name varies per
    // auth-setup user, so we match the testid prefix instead of the suffix.
    await expect(
      page.locator("[data-testid^='new-match-suggestion-0-']").first(),
    ).toBeVisible();
  });

  test("offline tap on a past match opens the detail page hydrated from the list cache", async ({
    page,
    context,
  }) => {
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const p1 = `Alice-${stamp}`;
    const p2 = `Bob-${stamp}`;

    // Online: create a match through the full UI flow so it lands in the
    // server-side history.
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");
    await page.fill("[data-testid='new-match-player-0']", p1);
    await page.fill("[data-testid='new-match-player-1']", p2);
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[^/?#]+$/);

    // Online: bounce back to /games. usePrefetchGames refetches the
    // per-game matches list and (via setQueryData) seeds ['matches', id]
    // for every row — so a tap on any history entry is a cache hit even if
    // we never opened that match's detail page. We wait on the matches list
    // response to make sure the hydration step has run before we go offline.
    await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/matches\?gameId=/.test(r.url()) && r.ok(),
      ),
      page.goto("/games"),
    ]);

    await context.setOffline(true);

    await page.click("text=7 Wonders Duel");
    await page.waitForURL("**/games/7-wonders-duel");

    const row = page.locator(`[data-testid^='match-history-row-']`).first();
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(/\/matches\/[^/?#]+$/);

    await expect(page.locator("[data-testid='score-grid']")).toBeVisible();
    await expect(page.locator("[data-testid='score-grid']")).toContainText(p1);
    await expect(page.locator("[data-testid='score-grid']")).toContainText(p2);
    await expect(
      page.getByText("This page wasn't saved for offline use", { exact: false }),
    ).not.toBeVisible();
  });

  test("offline match: create + score + reconnect replays the queue and migrates to the real id", async ({
    page,
    context,
  }) => {
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const p1 = `Alice-${stamp}`;
    const p2 = `Bob-${stamp}`;

    // Warm the prefetch so the new-match page can load offline.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/games/7-wonders-duel") && r.ok(),
      ),
      page.goto("/games"),
    ]);

    await context.setOffline(true);

    await page.click("text=7 Wonders Duel");
    await page.waitForURL("**/games/7-wonders-duel");
    await page.click("[data-testid='new-match-button']");
    await page.waitForURL("**/games/7-wonders-duel/new");

    await page.fill("[data-testid='new-match-player-0']", p1);
    await page.fill("[data-testid='new-match-player-1']", p2);
    await page.click("[data-testid='new-match-submit']");

    // Submit while offline takes the createDraftMatch path; the form
    // navigates straight to the synthetic /matches/draft_<uuid> URL.
    await page.waitForURL(/\/matches\/draft_/);
    await expect(page.locator("[data-testid='match-draft-badge']")).toBeVisible();
    await expect(page.locator("[data-testid='score-grid']")).toBeVisible();

    // Resolve draft player ids from the rendered grid so we can drive the
    // score inputs the same way the online flow does.
    const p1Id = await page
      .locator(`[data-testid^='score-grid-player-'] >> text=${p1}`)
      .first()
      .evaluate((el) =>
        el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
      );
    const p2Id = await page
      .locator(`[data-testid^='score-grid-player-'] >> text=${p2}`)
      .first()
      .evaluate((el) =>
        el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
      );

    // Score offline — the scorer detects the draft id and short-circuits to
    // optimistic + enqueue, so totals must update locally without a server
    // round-trip.
    await page
      .locator(`[data-testid='score-input-${p1Id}-civil']`)
      .fill("8");
    await page.locator(`[data-testid='score-input-${p1Id}-civil']`).blur();
    await page
      .locator(`[data-testid='score-input-${p2Id}-wonders']`)
      .fill("4");
    await page.locator(`[data-testid='score-input-${p2Id}-wonders']`).blur();

    await expect(
      page.locator(`[data-testid='score-grid-total-${p1Id}']`),
    ).toHaveText("8");
    await expect(
      page.locator(`[data-testid='score-grid-total-${p2Id}']`),
    ).toHaveText("4");

    // Reconnect — useOnlineStatus's handler fires syncEngine.flush, which
    // POSTs the queued match, captures the real ids, replays the queued
    // PATCHes against /api/matches/<realId>/scores with rewritten draft
    // player ids, and emits SYNC_DRAFTS_RESOLVED_EVENT so the route
    // redirects from /matches/draft_xxx to /matches/<realId>.
    await context.setOffline(false);

    await page.waitForURL(
      (url) =>
        /\/matches\//.test(url.pathname) && !/\/matches\/draft_/.test(url.pathname),
      { timeout: 15000 },
    );

    // Draft badge is gone, scores survived the migration.
    await expect(
      page.locator("[data-testid='match-draft-badge']"),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-testid^='score-grid-player-'] >> text=${p1}`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-testid^='score-grid-player-'] >> text=${p2}`),
    ).toBeVisible();

    // History reflects the real, post-flush match.
    await page.goto("/games/7-wonders-duel");
    await page.waitForLoadState("domcontentloaded");
    const history = page.locator("[data-testid='match-history']");
    await expect(history).toBeVisible();
    await expect(history).toContainText(p1);
    await expect(history).toContainText(p2);
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
