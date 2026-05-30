import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

/**
 * Players-tab "+ Add profile" entry point.
 *
 * Today the only way to create an owned profile is via the new-match
 * form's inline-create row. That blocks the QR-link flow when a friend
 * wants to scan you and you haven't yet played a match with them. The
 * Players-tab action provides a direct path: enter alias → land on the
 * profile detail page → ready to scan.
 */
test.describe("Players tab — + Add profile", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function signUpFresh(page: Page) {
    await login(page);
  }

  test("create flow lands on the new profile detail page", async ({ page }) => {
    await signUpFresh(page);

    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");

    const alias = `Added-${Math.random().toString(36).slice(2, 8)}`;

    await page.click("[data-testid='players-add-profile']");

    const input = page.locator("[data-testid='players-add-profile-input']");
    await expect(input).toBeVisible();
    await input.fill(alias);
    await page.click("[data-testid='players-add-profile-submit']");

    // Lands on the new profile detail page.
    await page.waitForURL(/\/players\/[a-z0-9-]+$/);
    await expect(page.locator("h1", { hasText: alias })).toBeVisible();

    // The profile shows up in the Players list when we navigate back.
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.locator("[data-testid='players-list']"),
    ).toContainText(alias);
  });

  test("cancel closes the form without creating a profile", async ({ page }) => {
    await signUpFresh(page);

    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");

    const trigger = page.locator("[data-testid='players-add-profile']");
    await trigger.click();

    const input = page.locator("[data-testid='players-add-profile-input']");
    await input.fill("Throwaway");

    // Cancel button is the "ghost" variant inside the same form.
    await page
      .locator("[data-testid='players-add-profile-form'] button", {
        hasText: /cancel|annuler/i,
      })
      .click();

    // Form collapsed, trigger button back.
    await expect(input).toHaveCount(0);
    await expect(trigger).toBeVisible();

    // No new profile in the list.
    const list = page.locator("[data-testid='players-list']");
    if (await list.count()) {
      await expect(list).not.toContainText("Throwaway");
    }
  });
});
