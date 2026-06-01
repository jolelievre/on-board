import { test, expect } from "@playwright/test";

/**
 * Auth-provider plumbing — the /api/auth/providers endpoint + the login
 * page's "render-only-enabled-providers" loop. Runs unconditionally:
 * doesn't need real Facebook/Apple credentials, just verifies the
 * config-driven UI works.
 *
 * In test mode (NODE_ENV=test) the server returns no social providers
 * regardless of GOOGLE_CLIENT_ID etc. — only the email/password form
 * renders. Outside test mode, the configured providers should appear.
 */

test.describe("Auth providers — config endpoint", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("GET /api/auth/providers returns a JSON list", async ({ request }) => {
    const res = await request.get("/api/auth/providers");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { providers: string[] };
    expect(Array.isArray(body.providers)).toBe(true);
    // All entries must be one of the supported provider ids; no junk.
    for (const id of body.providers) {
      expect(["google", "facebook"]).toContain(id);
    }
  });

  test("login page renders a button for each provider the endpoint reports", async ({
    page,
    request,
  }) => {
    const res = await request.get("/api/auth/providers");
    const { providers } = (await res.json()) as { providers: string[] };

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("h1", { timeout: 10000 });

    if (providers.length === 0) {
      // Test mode (or zero providers configured) — confirm no button leaks.
      await expect(page.locator("[data-provider]")).toHaveCount(0);
      return;
    }

    for (const id of providers) {
      await expect(page.locator(`[data-provider="${id}"]`)).toBeVisible();
    }

    // And nothing else: no buttons for providers the server didn't return.
    const renderedCount = await page.locator("[data-provider]").count();
    expect(renderedCount).toBe(providers.length);
  });
});

test.describe("Legal pages — public access", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/privacy is reachable without auth", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText(/privacy|confidentialité/i);
  });

  test("/terms is reachable without auth", async ({ page }) => {
    await page.goto("/terms");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText(/terms|conditions/i);
  });

  test("login page links to /privacy and /terms", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator('a[href="/terms"]')).toBeVisible();
    await expect(page.locator('a[href="/privacy"]')).toBeVisible();
  });
});
