import { test, expect } from "@playwright/test";

test.describe("Smoke", () => {
  test("homepage loads and shows login page", async ({ page }) => {
    // Clear auth state to test the unauthenticated login page
    await page.context().clearCookies();
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText("OnBoard");
  });

  test("health endpoint responds", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("ok");
  });
});
