import { test, expect } from "@playwright/test";

test.describe("Internationalization", () => {
  test("defaults to English", async ({ page }) => {
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Games");
  });

  test("can switch to French", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    await page.click("text=Français");
    await expect(page.locator("h1")).toContainText("Paramètres");
  });

  test("language persists on refresh", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    await page.click("text=Français");
    await expect(page.locator("h1")).toContainText("Paramètres");

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Paramètres");
  });

  test("can switch back to English", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    await page.click("text=Français");
    await expect(page.locator("h1")).toContainText("Paramètres");

    await page.click("text=English");
    await expect(page.locator("h1")).toContainText("Settings");
  });
});
