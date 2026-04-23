import { test, expect } from "@playwright/test";
import { loginViaUI } from "./helpers/auth";

test.describe("Authentication", () => {
  test("login page shows sign-in form in test mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("OnBoard");
    await expect(page.locator("input[name='email']")).toBeVisible();
    await expect(page.locator("input[name='password']")).toBeVisible();
  });

  test("can sign up and is redirected to /games", async ({ page }) => {
    await loginViaUI(page);
    await expect(page.locator("h1")).toContainText("Games");
  });

  test("protected route /games redirects to / when not authenticated", async ({
    page,
  }) => {
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");

    // Should redirect back to login
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
