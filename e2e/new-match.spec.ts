import { test, expect } from "@playwright/test";

function stamp() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

test.describe("New match form — dynamic player count", () => {
  test("7 Wonders Duel locks at exactly 2 players (no add/remove)", async ({
    page,
  }) => {
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.locator("[data-testid='new-match-player-0']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='new-match-player-1']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='new-match-player-2']"),
    ).toHaveCount(0);

    await expect(
      page.locator("[data-testid='new-match-add-player']"),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-testid='new-match-remove-0']"),
    ).toHaveCount(0);
  });

  test("Skull King starts at 2, allows up to 8 players", async ({ page }) => {
    await page.goto("/games/skull-king/new");
    await page.waitForLoadState("domcontentloaded");

    // Starts at minPlayers (2)
    await expect(
      page.locator("[data-testid='new-match-player-1']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='new-match-player-2']"),
    ).toHaveCount(0);
    // No remove buttons at min
    await expect(
      page.locator("[data-testid='new-match-remove-0']"),
    ).toHaveCount(0);

    // Add 6 more players (2 → 8)
    for (let i = 0; i < 6; i++) {
      await page.click("[data-testid='new-match-add-player']");
    }

    await expect(
      page.locator("[data-testid='new-match-player-7']"),
    ).toBeVisible();
    // Add button hidden at max
    await expect(
      page.locator("[data-testid='new-match-add-player']"),
    ).toHaveCount(0);
    // Remove buttons present (above min)
    await expect(
      page.locator("[data-testid='new-match-remove-0']"),
    ).toBeVisible();

    // Remove brings us back down
    await page.click("[data-testid='new-match-remove-7']");
    await expect(
      page.locator("[data-testid='new-match-player-7']"),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-testid='new-match-add-player']"),
    ).toBeVisible();
  });

  test("can create a 3-player match (Skull King)", async ({ page }) => {
    await page.goto("/games/skull-king/new");
    await page.waitForLoadState("domcontentloaded");

    await page.click("[data-testid='new-match-add-player']");

    const s = stamp();
    await page.fill("[data-testid='new-match-player-0']", `Captain-${s}`);
    await page.fill("[data-testid='new-match-player-1']", `Mate-${s}`);
    await page.fill("[data-testid='new-match-player-2']", `Cook-${s}`);

    await page.click("[data-testid='new-match-submit']");
    // Form did its job once we land on a match URL. What renders next
    // is the per-game scorer's responsibility (covered in skull-king.spec.ts).
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
  });

  test("duplicate names are rejected with an inline error", async ({
    page,
  }) => {
    await page.goto("/games/skull-king/new");
    await page.waitForLoadState("domcontentloaded");

    await page.fill("[data-testid='new-match-player-0']", "Same");
    await page.fill("[data-testid='new-match-player-1']", "same");
    await page.click("[data-testid='new-match-submit']");

    await expect(page.locator("[data-testid='new-match-error']")).toContainText(
      /different names|noms différents/,
    );
  });
});
