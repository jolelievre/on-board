import { test, expect } from "@playwright/test";

test.describe("Public install help page", () => {
  // Public route — no stored auth needed.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/install renders without authentication", async ({ page }) => {
    await page.goto("/install");
    await page.waitForLoadState("domcontentloaded");
    // Page must not redirect to /
    await expect(page).toHaveURL(/\/install$/);
    await expect(page.locator("h1")).toContainText("Install OnBoard");
  });

  test("iOS and Android sections are both present, default-open follows UA", async ({
    page,
  }) => {
    await page.goto("/install");
    await page.waitForLoadState("domcontentloaded");

    const ios = page.getByTestId("install-section-ios");
    const android = page.getByTestId("install-section-android");
    await expect(ios).toBeVisible();
    await expect(android).toBeVisible();

    // Playwright's iPhone-13 device descriptor has an iOS UA → iOS section
    // should be open by default and Android should be collapsed. Mobile
    // Chrome (Pixel 5) → Android default-open. Either way the *other*
    // section should still be clickable to expand.
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const isIOSUA = /iPhone|iPad/.test(userAgent);
    if (isIOSUA) {
      await expect(ios).toHaveAttribute("data-open", "true");
      await expect(android).toHaveAttribute("data-open", "false");
    } else {
      await expect(android).toHaveAttribute("data-open", "true");
      // iOS may be open or closed depending on detection — the relevant
      // assertion is that toggling works in either direction.
    }
  });

  test("toggle expands and collapses a section", async ({ page }) => {
    await page.goto("/install");
    await page.waitForLoadState("domcontentloaded");

    const section = page.getByTestId("install-section-android");
    const toggle = page.getByTestId("install-section-android-toggle");
    const startOpen = (await section.getAttribute("data-open")) === "true";

    await toggle.click();
    await expect(section).toHaveAttribute(
      "data-open",
      startOpen ? "false" : "true",
    );

    await toggle.click();
    await expect(section).toHaveAttribute(
      "data-open",
      startOpen ? "true" : "false",
    );
  });

  test("login page links to /install", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    const link = page.getByTestId("login-install-link");
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/install$/);
    await expect(page.locator("h1")).toContainText("Install OnBoard");
  });
});

test.describe("Settings version footer", () => {
  // Uses the default saved auth state from auth.setup.ts — no need to
  // re-login per test.
  test("shows app version", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    const footer = page.getByTestId("settings-version-footer");
    await expect(footer).toBeVisible();
    // Format: `OnBoard v0.0.1` optionally followed by ` · <7-char sha>`.
    await expect(footer).toContainText(/^OnBoard v\d+\.\d+\.\d+/);
  });
});
