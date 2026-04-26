import { test, expect } from "@playwright/test";
import { isTestAuthMode, login } from "./helpers/auth";

test.describe("Authentication — universal", () => {
  // These tests run WITHOUT stored auth state
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login page shows app name", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("OnBoard");
  });

  test("protected route /games redirects to / when not authenticated", async ({
    page,
  }) => {
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForURL("/", { timeout: 5000 });
    await expect(page.locator("h1")).toContainText("OnBoard");
  });

  test("protected route /settings redirects to / when not authenticated", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForURL("/", { timeout: 5000 });
    await expect(page.locator("h1")).toContainText("OnBoard");
  });

  test("API returns 401 for protected routes without auth", async ({
    request,
  }) => {
    const matchesRes = await request.get("/api/matches");
    expect(matchesRes.status()).toBe(401);

    const playersRes = await request.get("/api/players/suggestions");
    expect(playersRes.status()).toBe(401);
  });
});

test.describe("Authentication — logout", () => {
  // Logout invalidates the session server-side, so these tests
  // use their own fresh login to avoid breaking other tests.
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(!isTestAuthMode(), "Skipped: logout tests need test auth mode for fresh login");

  test("can sign out and is redirected to login page", async ({ page }) => {
    await login(page);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("Settings");

    await page.click("text=Sign out");

    await page.waitForURL("/", { timeout: 10000 });
    await expect(page.locator("h1")).toContainText("OnBoard");
  });

  test("cannot access protected routes after sign out", async ({ page }) => {
    await login(page);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    await page.click("text=Sign out");
    await page.waitForURL("/", { timeout: 10000 });

    // Try to access a protected route
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForURL("/", { timeout: 5000 });
    await expect(page.locator("h1")).toContainText("OnBoard");
  });
});

test.describe("Authentication — test mode only", () => {
  test.skip(!isTestAuthMode(), "Skipped: not in test auth mode");
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login page shows email/password form", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("input[name='email']")).toBeVisible();
    await expect(page.locator("input[name='password']")).toBeVisible();
  });
});

test.describe("Authentication — Google OAuth only", () => {
  test.skip(isTestAuthMode(), "Skipped: in test auth mode");
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login page shows Google sign-in button", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("text=Sign in with Google")).toBeVisible();
  });
});
