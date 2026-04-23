import { test, expect } from "@playwright/test";

test("homepage loads and shows app name", async ({ page }) => {
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
