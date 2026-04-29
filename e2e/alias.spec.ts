import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

/**
 * Alias feature tests.
 *
 * Each test signs up a fresh user (no shared auth state) so setting the
 * alias doesn't bleed into the rest of the suite.
 */
test.describe("Alias — settings + propagation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function signUpFresh(page: Page) {
    await login(page);
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    return {
      id: session.user.id as string,
      name: session.user.name as string,
    };
  }

  test("editing the alias shows the saved badge and persists across reload", async ({
    page,
  }) => {
    await signUpFresh(page);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    const input = page.locator("[data-testid='settings-alias-input']");
    await expect(input).toHaveValue("");
    await input.fill("Jo");
    await input.blur();

    const savedBadge = page.locator("[data-testid='settings-alias-saved']");
    await expect(savedBadge).toBeVisible();

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.locator("[data-testid='settings-alias-input']"),
    ).toHaveValue("Jo");
  });

  test("clearing the alias falls back to the full name in the self chip", async ({
    page,
  }) => {
    const user = await signUpFresh(page);

    // Set alias via the UI
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='settings-alias-input']").fill("Jo");
    await page.locator("[data-testid='settings-alias-input']").blur();
    await expect(
      page.locator("[data-testid='settings-alias-saved']"),
    ).toBeVisible();

    // Self chip should show the alias
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='new-match-player-0']");
    await expect(
      page.locator("[data-testid='new-match-suggestion-0-Jo']"),
    ).toBeVisible();
    await expect(
      page.locator(
        `[data-testid='new-match-suggestion-0-${user.name}']`,
      ),
    ).toHaveCount(0);

    // Clear the alias
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='settings-alias-input']").fill("");
    await page.locator("[data-testid='settings-alias-input']").blur();

    // Self chip falls back to the full name
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='new-match-player-0']");
    await expect(
      page.locator(
        `[data-testid='new-match-suggestion-0-${user.name}']`,
      ),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='new-match-suggestion-0-Jo']"),
    ).toHaveCount(0);
  });

  test("alias retroactively updates match history for linked players", async ({
    page,
  }) => {
    const user = await signUpFresh(page);

    // Create a past match with the current user as a linked player.
    // We send userId === user.id so the Player gets attached to the User.
    const gamesRes = await page.request.get("/api/games/7-wonders-duel");
    const game = await gamesRes.json();
    const matchRes = await page.request.post("/api/matches", {
      data: {
        gameId: game.id,
        players: [
          { name: user.name, position: 0, userId: user.id },
          { name: "Friend", position: 1 },
        ],
      },
    });
    expect(matchRes.ok()).toBeTruthy();

    // Now change the alias AFTER the match was created.
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='settings-alias-input']").fill("Jo");
    await page.locator("[data-testid='settings-alias-input']").blur();
    await expect(
      page.locator("[data-testid='settings-alias-saved']"),
    ).toBeVisible();

    // Game detail history should show the alias, NOT the original name
    await page.goto("/games/7-wonders-duel");
    await page.waitForLoadState("domcontentloaded");
    const history = page.locator("[data-testid='match-history']");
    await expect(history).toBeVisible();
    await expect(history).toContainText("Jo");
    await expect(history).not.toContainText(user.name);
  });

  test("alias propagates into the in-progress match score grid", async ({
    page,
  }) => {
    const user = await signUpFresh(page);

    // Set alias first so the match is created with already-aliased display
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='settings-alias-input']").fill("Jo");
    await page.locator("[data-testid='settings-alias-input']").blur();
    await expect(
      page.locator("[data-testid='settings-alias-saved']"),
    ).toBeVisible();

    // Start a new match — pick the self chip for player 0
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='new-match-player-0']");
    await page.click("[data-testid='new-match-suggestion-0-Jo']");
    await page.fill("[data-testid='new-match-player-1']", "Friend");
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);

    // The score grid's player block should show the alias, not the
    // user's full name
    const scoreGrid = page.locator("[data-testid='score-grid']");
    await expect(scoreGrid).toContainText("Jo");
    await expect(scoreGrid).not.toContainText(user.name);
  });
});
