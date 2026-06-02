import { test, expect, type Page } from "@playwright/test";
import { isTestAuthMode } from "./helpers/auth";

/**
 * /stats dashboard — PR 8-C.
 *
 * Seeds a known-shape 7WD history for a brand-new user, then navigates
 * to /stats and asserts the hero strip, favourites, per-game card, and
 * rankings panel all reflect a hand-computed reference.
 *
 * Driven through the UI (clicks, score inputs, complete button) — not
 * the API. The dashboard reads off Dexie via `useLiveQuery`, so an
 * API-shortcut would skip the same client-cache layer the hooks read
 * from and could pass while the page misses an `onSuccess`
 * invalidation. See [[feedback_ui_e2e_for_user_flows]].
 *
 * Uses a fresh sign-up per test so the seeded match counts are
 * deterministic regardless of what other parallel specs do with the
 * shared default user.
 */

const stamp = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function signUpFresh(page: Page, label: string) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("input[name='email']");
  await page.fill("input[name='name']", `Stats ${label} ${stamp()}`);
  await page.fill(
    "input[name='email']",
    `stats-${label}-${stamp()}@example.com`,
  );
  await page.fill("input[name='password']", "testpassword123");
  await page.click("button[type='submit']");
  await page.waitForURL("**/games", { timeout: 10000 });
}

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
) {
  const input = page.locator(
    `[data-testid='score-input-${playerId}-${category}']`,
  );
  await input.fill(String(value));
  await input.blur();
}

async function play7WDMatch(
  page: Page,
  opts: {
    myName: string;
    opponentName: string;
    myScore: number;
    opponentScore: number;
  },
) {
  await page.goto("/games/7-wonders-duel/new");
  await page.waitForLoadState("domcontentloaded");
  await page.fill("[data-testid='new-match-player-0']", opts.myName);
  await page.fill("[data-testid='new-match-player-1']", opts.opponentName);
  await page.click("[data-testid='new-match-submit']");
  await page.waitForURL(/\/matches\/[a-z0-9-]+/i);

  const myId = await resolvePlayerId(page, opts.myName);
  const oppId = await resolvePlayerId(page, opts.opponentName);

  // Concentrate the points in `civil` so the per-match totals match the
  // input exactly; categories are summed so any single category works.
  await setScore(page, myId, "civil", opts.myScore);
  await setScore(page, oppId, "civil", opts.opponentScore);

  // Let the debounced PATCH land before we click Complete — without
  // this the completion request can race and pick up a stale winner.
  await page.waitForResponse(
    (r) =>
      /\/api\/matches\/[^/]+\/scores$/.test(r.url()) &&
      r.request().method() === "PATCH" &&
      r.ok(),
    { timeout: 5000 },
  );

  await page.click("[data-testid='complete-match']");
  await expect(page.locator("[data-testid='winner-banner']")).toBeVisible();
  await page.click("[data-testid='back-to-game']");
  await page.waitForURL("**/games/7-wonders-duel");
}

test.describe("/stats dashboard", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(
    !isTestAuthMode(),
    "Skipped: needs test-mode email/password sign-up for a fresh user",
  );

  test("empty state for brand-new user", async ({ page }) => {
    await signUpFresh(page, "empty");

    // Reach /stats via the bottom-nav tab so we exercise the actual
    // navigation surface, not just direct URL nav.
    await page.click("a[href='/stats']");
    await page.waitForURL("**/stats");
    await page.waitForLoadState("domcontentloaded");

    // Hero strip renders with zeroes — the page never hides the strip
    // entirely, so a new user still sees a "0 matches" frame.
    await expect(page.locator("[data-testid='stats-hero-matches']")).toContainText(
      "0",
    );
    await expect(
      page.locator("[data-testid='stats-hero-wins']"),
    ).toContainText("0");

    // The "no matches yet" empty hint sits in place of the favourites
    // panel.
    await expect(page.locator("[data-testid='stats-empty']")).toBeVisible();

    // Every per-game card lands in its empty-state branch (CTA → /new).
    const emptyCards = page.locator("[data-testid='stats-game-card']");
    await expect(emptyCards.first()).toBeVisible();
    for (const card of await emptyCards.all()) {
      // Empty cards link to /games/<slug>/new — `href` ends with /new.
      const href = await card.getAttribute("href");
      expect(href).toMatch(/\/games\/[a-z0-9-]+\/new$/);
    }

    // Rankings sections render nothing when no matches exist — the
    // rankings group's sections each return null individually.
    await expect(
      page.locator("[data-testid='stats-rankings-section']"),
    ).toHaveCount(0);
  });

  test("computed totals + per-game + rankings match a seeded reference", async ({
    page,
  }) => {
    await signUpFresh(page, "seed");

    // Read viewer's display name so we can address ourselves in the
    // new-match form (the alias suggestion is auto-populated as the
    // current user, but here we fill explicitly to keep totals
    // deterministic regardless of suggestion ordering).
    const sessionRes = await page.request.get("/api/auth/get-session");
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const me = session.user.name as string;

    // Seed three 7WD matches:
    //   #1 — I win 20–10 vs Alice
    //   #2 — Alice beats me 5–30
    //   #3 — I win 25–5 vs Bob
    // Completed-at order = creation order (the loop is sequential).
    //
    // Expected derived values (hand-computed):
    //   matches/completed = 3, wins = 2, win-rate = 67%
    //   best score = 25 (the M3 score I posted in `civil`)
    //   current streak = 1 (M3 win after the M2 loss)
    //   max streak = 1 (M1 and M3 wins are separated by M2 loss)
    //   favourite game = "7 Wonders Duel", 3 matches
    //   favourite opponent = Alice (2 matches together) > Bob (1)
    //
    // Rankings @ 7WD (3-match gate):
    //   me — 3 completed, 2 wins → ranked, 67%
    //   Alice — 2 completed, 1 win → gated ("2/3")
    //   Bob — 1 completed, 0 wins → gated ("1/3")
    const aliceName = `Alice-${stamp()}`;
    const bobName = `Bob-${stamp()}`;
    await play7WDMatch(page, {
      myName: me,
      opponentName: aliceName,
      myScore: 20,
      opponentScore: 10,
    });
    await play7WDMatch(page, {
      myName: me,
      opponentName: aliceName,
      myScore: 5,
      opponentScore: 30,
    });
    await play7WDMatch(page, {
      myName: me,
      opponentName: bobName,
      myScore: 25,
      opponentScore: 5,
    });

    await page.goto("/stats");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-testid='stats-hero']")).toBeVisible();

    // Hero strip
    await expect(
      page.locator("[data-testid='stats-hero-matches']"),
    ).toContainText("3");
    await expect(
      page.locator("[data-testid='stats-hero-completed']"),
    ).toContainText("3");
    await expect(
      page.locator("[data-testid='stats-hero-wins']"),
    ).toContainText("2");
    await expect(
      page.locator("[data-testid='stats-hero-win-rate']"),
    ).toContainText("67%");

    // Favourites — game card links to 7WD detail; opponent card shows
    // Alice's alias.
    await expect(
      page.locator("[data-testid='stats-favourite-game']"),
    ).toContainText(/7 Wonders Duel|7 Merveilles Duel/);
    const opponentCard = page.locator(
      "[data-testid='stats-favourite-opponent']",
    );
    await expect(opponentCard).toContainText(aliceName);

    // Per-game card for 7WD
    const sevenWDCard = page.locator(
      "[data-testid='stats-game-card'][data-game-slug='7-wonders-duel']",
    );
    await expect(sevenWDCard).toBeVisible();
    await expect(
      sevenWDCard.locator("[data-testid='stats-game-matches']"),
    ).toContainText("3");
    await expect(
      sevenWDCard.locator("[data-testid='stats-game-win-rate']"),
    ).toContainText("67%");
    await expect(
      sevenWDCard.locator("[data-testid='stats-game-best-score']"),
    ).toContainText("25");
    await expect(
      sevenWDCard.locator("[data-testid='stats-game-current-streak']"),
    ).toContainText("1");
    await expect(
      sevenWDCard.locator("[data-testid='stats-game-max-streak']"),
    ).toContainText("1");

    // Skull King card stays in the empty state — link target ends in
    // /new.
    const skullCard = page.locator(
      "[data-testid='stats-game-card'][data-game-slug='skull-king']",
    );
    await expect(skullCard).toBeVisible();
    const skullHref = await skullCard.getAttribute("href");
    expect(skullHref).toMatch(/\/games\/skull-king\/new$/);

    // Rankings — viewer is the only ranked entry; Alice and Bob are
    // gated. Constrain the locator to the 7WD section since Skull
    // King's section won't render (no matches).
    const sevenWDRankings = page.locator(
      "[data-testid='stats-rankings-section'][data-game-slug='7-wonders-duel']",
    );
    await expect(sevenWDRankings).toBeVisible();

    const meRow = sevenWDRankings
      .locator("[data-testid='stats-ranking-row']")
      .filter({ hasText: /You|Vous/ });
    await expect(meRow).toHaveAttribute("data-ranked", "true");
    await expect(meRow).toContainText("67%");

    const aliceRow = sevenWDRankings
      .locator("[data-testid='stats-ranking-row']")
      .filter({ hasText: aliceName });
    await expect(aliceRow).toHaveAttribute("data-ranked", "false");
    await expect(aliceRow).toContainText("2/3");

    const bobRow = sevenWDRankings
      .locator("[data-testid='stats-ranking-row']")
      .filter({ hasText: bobName });
    await expect(bobRow).toHaveAttribute("data-ranked", "false");
    await expect(bobRow).toContainText("1/3");
  });
});
