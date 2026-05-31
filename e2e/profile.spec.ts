import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

/**
 * Profile-detail UI tests for PR 6-B.
 *
 * Each test signs up a fresh user so created profiles + matches don't
 * bleed into the rest of the suite.
 */

test.describe("Profile detail — merge", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function signUpFresh(page: Page) {
    await login(page);
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    return {
      id: session.user.id as string,
      name: session.user.name as string,
    };
  }

  test("merging two unclaimed profiles via the dialog collapses match references", async ({
    page,
  }) => {
    await signUpFresh(page);

    const stamp = Math.random().toString(36).slice(2, 8);
    const survivor = `Alice-${stamp}`;
    const dupe = `Aliss-${stamp}`;

    // Seed a match referencing both aliases so the merge has something
    // to rewrite. Auto-create happens at submit; we go through the UI
    // because that's the documented happy path.
    await page.goto("/games/skull-king/new");
    await page.waitForLoadState("domcontentloaded");
    await page.fill("[data-testid='new-match-player-0']", survivor);
    await page.fill("[data-testid='new-match-player-1']", dupe);
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);

    // Open the dupe profile from the Players tab.
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    const dupeRow = page.locator("[data-testid='player-row']", {
      hasText: dupe,
    });
    await expect(dupeRow).toBeVisible();
    await dupeRow.click();
    await page.waitForURL(/\/players\/[a-z0-9-]+$/);

    // Trigger merge.
    await page.click("[data-testid='profile-merge-action']");
    const survivorButton = page
      .locator("[data-testid^='merge-candidate-']", { hasText: survivor })
      .first();
    await expect(survivorButton).toBeVisible();
    await survivorButton.click();
    await page.click("[data-testid='merge-confirm']");

    // After merge we land on the surviving profile's page.
    await page.waitForURL(/\/players\/[a-z0-9-]+$/);
    await expect(page.locator("h1", { hasText: survivor })).toBeVisible();

    // The duplicate is gone from the Players tab.
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.locator("[data-testid='player-row']", { hasText: dupe }),
    ).toHaveCount(0);
  });
});

test.describe("Profile detail — avatar uploader", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // 1×1 transparent PNG — sharp accepts it without complaint and the
  // round-trip is small enough to keep this test fast.
  const TINY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );

  async function signUpFresh(page: Page) {
    await login(page);
  }

  test("gallery upload writes the customAvatarUrl + clears restores defaults", async ({
    page,
  }) => {
    await signUpFresh(page);

    const stamp = Math.random().toString(36).slice(2, 8);
    const alias = `Avatar-${stamp}`;

    // Create the profile via the new-match flow (auto-creates on submit).
    await page.goto("/games/skull-king/new");
    await page.waitForLoadState("domcontentloaded");
    await page.fill("[data-testid='new-match-player-0']", alias);
    await page.fill("[data-testid='new-match-player-1']", `Other-${stamp}`);
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);

    // Open the profile detail page.
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator("[data-testid='player-row']", { hasText: alias })
      .click();
    await page.waitForURL(/\/players\/[a-z0-9-]+$/);

    // Enter photo edit mode — the uploader is hidden by default.
    await page.click("[data-testid='profile-edit-avatar']");
    await expect(
      page.locator("[data-testid='avatar-uploader']"),
    ).toBeVisible();

    // Upload via the hidden file input — same code path the Hub's
    // "From gallery" action triggers (it's a programmatic click on this
    // input). Studio jumps to the reposition screen on load.
    await page
      .locator("[data-testid='avatar-file-input']")
      .setInputFiles({
        name: "test.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });

    // Reposition → Use photo: bakes the square crop and advances to the
    // Style screen.
    await expect(
      page.locator("[data-testid='studio-reposition']"),
    ).toBeVisible();
    await page.click("[data-testid='studio-reposition-confirm']");

    // Style → Save stamp: uploads the baked square + persists frame/ring.
    await expect(page.locator("[data-testid='studio-style']")).toBeVisible();
    await page.click("[data-testid='studio-style-save']");

    // Success state confirms the upload landed.
    await expect(page.locator("[data-testid='studio-saved']")).toBeVisible();
    await page.click("[data-testid='studio-saved-done']");

    // Re-enter the studio to verify the dashed "Use my X monogram" row
    // is now visible (only when the profile has a custom photo) and
    // that clearing it puts us back in the no-photo state.
    await page.click("[data-testid='profile-edit-avatar']");
    await expect(
      page.locator("[data-testid='studio-clear-photo']"),
    ).toBeVisible();
    await page.click("[data-testid='studio-clear-photo']");
    await expect(
      page.locator("[data-testid='studio-clear-photo']"),
    ).toHaveCount(0);

    // Close the studio via the hub's Cancel footer.
    await page.click("[data-testid='avatar-done']");
    await expect(
      page.locator("[data-testid='avatar-uploader']"),
    ).toHaveCount(0);
  });
});
