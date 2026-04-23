import { test, expect } from "@playwright/test";
import { loginViaUI } from "./helpers/auth";

test.describe("Navigation", () => {
  test("can navigate from game list to game detail", async ({ page }) => {
    await loginViaUI(page);

    await expect(page.locator("h1")).toContainText("Games");

    // Click on a game
    await page.click("text=7 Wonders Duel");
    await page.waitForURL("**/games/7-wonders-duel");
    await expect(page.locator("h1")).toContainText("7 Wonders Duel");
  });

  test("can navigate to settings", async ({ page }) => {
    await loginViaUI(page);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Settings");
  });

  test("can navigate back from game detail to game list", async ({ page }) => {
    await loginViaUI(page);

    await page.goto("/games/7-wonders-duel");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("7 Wonders Duel");

    // Click back link
    await page.click("text=Games");
    await page.waitForURL("**/games");
    await expect(page.locator("h1")).toContainText("Games");
  });
});
