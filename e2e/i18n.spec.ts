import { test, expect } from "@playwright/test";
import { loginViaUI } from "./helpers/auth";

test.describe("Internationalization", () => {
  test("defaults to English", async ({ page }) => {
    await loginViaUI(page);

    // Should be on /games with English text
    await expect(page.locator("h1")).toContainText("Games");
  });

  test("can switch to French", async ({ page }) => {
    await loginViaUI(page);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Click French language button
    await page.click("text=Français");

    // Settings page should now be in French
    await expect(page.locator("h1")).toContainText("Paramètres");
  });

  test("language persists on refresh", async ({ page }) => {
    await loginViaUI(page);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Switch to French
    await page.click("text=Français");
    await expect(page.locator("h1")).toContainText("Paramètres");

    // Reload page
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Should still be in French
    await expect(page.locator("h1")).toContainText("Paramètres");
  });

  test("can switch back to English", async ({ page }) => {
    await loginViaUI(page);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Switch to French first
    await page.click("text=Français");
    await expect(page.locator("h1")).toContainText("Paramètres");

    // Switch back to English
    await page.click("text=English");
    await expect(page.locator("h1")).toContainText("Settings");
  });
});
