import { test, expect } from "@playwright/test";

function uniqueName(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

test.describe("Skull King", () => {
  test("scoring is not yet supported — match shows the fallback", async ({
    page,
  }) => {
    await page.goto("/games/skull-king/new");
    await page.waitForLoadState("domcontentloaded");

    await page.fill("[data-testid='new-match-player-0']", uniqueName("Captain"));
    await page.fill("[data-testid='new-match-player-1']", uniqueName("Mate"));
    await page.click("[data-testid='new-match-submit']");

    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);

    await expect(
      page.locator("[data-testid='scoring-not-supported']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='scoring-not-supported']"),
    ).toContainText(/Skull King/);

    // No 7WD grid leaks into a Skull King match
    await expect(page.locator("[data-testid='score-grid']")).toHaveCount(0);

    // Back link returns to the game detail page
    await page.click("[data-testid='back-to-game']");
    await page.waitForURL("**/games/skull-king");
  });
});
