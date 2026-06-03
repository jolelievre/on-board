import { test, expect, type Page } from "@playwright/test";
import { isTestAuthMode } from "./helpers/auth";

/**
 * Achievements row — PR 8-D.
 *
 * Drives a real win through the UI (not via API) and then asserts the
 * achievements stamps appear on both /stats (viewer's self-Profile)
 * and /players/$profileId (viewing a friend's profile).
 *
 * Uses a fresh sign-up per test so accumulated state from other specs
 * doesn't pre-unlock stamps.
 */

const stamp = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function signUpFresh(page: Page, label: string) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("input[name='email']");
  await page.fill("input[name='name']", `Ach ${label} ${stamp()}`);
  await page.fill(
    "input[name='email']",
    `ach-${label}-${stamp()}@example.com`,
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
  await setScore(page, myId, "civil", opts.myScore);
  await setScore(page, oppId, "civil", opts.opponentScore);
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

test.describe("achievements row", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(
    !isTestAuthMode(),
    "Skipped: needs test-mode email/password sign-up for a fresh user",
  );

  test("first 7WD win unlocks firstWin + biggestBlowout on /stats", async ({
    page,
  }) => {
    await signUpFresh(page, "self");

    const sessionRes = await page.request.get("/api/auth/get-session");
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const me = session.user.name as string;

    const opponentName = `Bob-${stamp()}`;
    await play7WDMatch(page, {
      myName: me,
      opponentName,
      myScore: 30,
      opponentScore: 7,
    });

    await page.goto("/stats");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='stats-tab-achievements']");

    const stamps = page.locator("[data-testid='achievement-stamp']");
    await expect(stamps.filter({ hasText: /First win|Première victoire/ })).toBeVisible();
    await expect(
      stamps.filter({ hasText: /Biggest blowout|Plus gros écart/ }),
    ).toBeVisible();

    const firstWin = page.locator(
      "[data-testid='achievement-stamp'][data-achievement-key='firstWin']",
    );
    await expect(firstWin).toHaveCount(1);

    // Locked stamps stay out of the DOM in v1 (no teasers).
    const tenWins = page.locator(
      "[data-testid='achievement-stamp'][data-achievement-key='tenWins']",
    );
    await expect(tenWins).toHaveCount(0);
    const streak = page.locator(
      "[data-testid='achievement-stamp'][data-achievement-key='winStreak5']",
    );
    await expect(streak).toHaveCount(0);
  });

  test("5 consecutive wins unlocks winStreak5", async ({ page }) => {
    await signUpFresh(page, "streak");

    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;
    const opponentName = `Carol-${stamp()}`;

    for (let i = 0; i < 5; i += 1) {
      await play7WDMatch(page, {
        myName: me,
        opponentName,
        myScore: 20,
        opponentScore: 5,
      });
    }

    await page.goto("/stats");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='stats-tab-achievements']");

    const streak = page.locator(
      "[data-testid='achievement-stamp'][data-achievement-key='winStreak5']",
    );
    await expect(streak).toBeVisible();
    await expect(streak).toContainText(/7 Wonders Duel|7 Merveilles Duel/);
  });

  test("1-point margin win unlocks Photo finish", async ({ page }) => {
    await signUpFresh(page, "photo");
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;

    await play7WDMatch(page, {
      myName: me,
      opponentName: `Eli-${stamp()}`,
      myScore: 21,
      opponentScore: 20,
    });

    await page.goto("/stats");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='stats-tab-achievements']");

    const photo = page.locator(
      "[data-testid='achievement-stamp'][data-achievement-key='photoFinish']",
    );
    await expect(photo).toBeVisible();
  });

  test("5 distinct opponents unlocks Roundabout", async ({ page }) => {
    await signUpFresh(page, "round");
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;

    for (let i = 0; i < 5; i += 1) {
      await play7WDMatch(page, {
        myName: me,
        opponentName: `Friend${i}-${stamp()}`,
        myScore: 15,
        opponentScore: 10,
      });
    }

    await page.goto("/stats");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='stats-tab-achievements']");

    const round = page.locator(
      "[data-testid='achievement-stamp'][data-achievement-key='roundabout']",
    );
    await expect(round).toBeVisible();
  });

  test("clicking a stamp toggles its description", async ({ page }) => {
    await signUpFresh(page, "click");
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;

    await play7WDMatch(page, {
      myName: me,
      opponentName: `Frank-${stamp()}`,
      myScore: 25,
      opponentScore: 12,
    });

    await page.goto("/stats");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='stats-tab-achievements']");

    const firstWin = page.locator(
      "[data-testid='achievement-stamp'][data-achievement-key='firstWin']",
    );
    await expect(firstWin).toBeVisible();
    await expect(
      firstWin.locator("[data-testid='achievement-description']"),
    ).toHaveCount(0);

    await firstWin.click();
    await expect(
      firstWin.locator("[data-testid='achievement-description']"),
    ).toBeVisible();
    await expect(firstWin).toHaveAttribute("aria-expanded", "true");

    await firstWin.click();
    await expect(
      firstWin.locator("[data-testid='achievement-description']"),
    ).toHaveCount(0);
  });

  test("tab nav swaps stats and achievements panels", async ({ page }) => {
    await signUpFresh(page, "tabs");
    await page.goto("/stats");
    await page.waitForLoadState("domcontentloaded");

    // Default tab is "stats" — hero strip visible, achievements panel hidden.
    await expect(page.locator("[data-testid='stats-panel']")).toBeVisible();
    await expect(page.locator("[data-testid='stats-hero']")).toBeVisible();
    await expect(
      page.locator("[data-testid='achievements-panel']"),
    ).toHaveCount(0);

    await page.click("[data-testid='stats-tab-achievements']");
    await expect(
      page.locator("[data-testid='achievements-panel']"),
    ).toBeVisible();
    await expect(page.locator("[data-testid='stats-hero']")).toHaveCount(0);

    await page.click("[data-testid='stats-tab-stats']");
    await expect(page.locator("[data-testid='stats-panel']")).toBeVisible();
    await expect(page.locator("[data-testid='stats-hero']")).toBeVisible();
  });

  test("opponent's profile page shows their unlocked stamp", async ({
    page,
  }) => {
    await signUpFresh(page, "friend");

    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;

    // Set up a single match where the opponent wins. Their profile
    // should then surface firstWin from my perspective (since the
    // match is visible to me as creator).
    const opponentName = `Dana-${stamp()}`;
    await play7WDMatch(page, {
      myName: me,
      opponentName,
      myScore: 5,
      opponentScore: 25,
    });

    // Reach the opponent's profile via the Players tab.
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    const opponentCard = page
      .locator("[data-testid='player-row']")
      .filter({ hasText: opponentName });
    await opponentCard.click();
    await page.waitForURL(/\/players\/[^/]+/);

    const stamps = page.locator("[data-testid='achievement-stamp']");
    await expect(stamps.first()).toBeVisible();
    const firstWin = page.locator(
      "[data-testid='achievement-stamp'][data-achievement-key='firstWin']",
    );
    await expect(firstWin).toHaveCount(1);
  });
});
