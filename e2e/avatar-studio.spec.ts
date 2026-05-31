import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

/**
 * Phase 7 — Avatar Capture Studio happy path. Drives the four-screen
 * state machine via the gallery path (file fixture), confirms the
 * reposition crop, picks a non-default frame + ring, saves, and
 * asserts the studio reaches the "Saved" success state. The styled
 * stamp's frame + ring are exposed via inline CSS variables on the
 * `<Avatar>` element so we can verify the persisted choice from the
 * DOM without round-tripping through the server projection.
 */

// 1×1 transparent PNG — large enough to load, small enough to keep the
// test fast. Same fixture as `profile.spec.ts`.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.describe("Avatar Capture Studio — gallery → reposition → style → save", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function signUpFresh(page: Page) {
    await login(page);
  }

  test("gallery upload + frame + ring persist as a stamp", async ({ page }) => {
    await signUpFresh(page);

    const stamp = Math.random().toString(36).slice(2, 8);
    const alias = `Studio-${stamp}`;

    // Seed a profile via the new-match form (the documented happy path
    // for owner-created profiles); the resulting profile is owned by
    // the signed-in user so the studio's edit affordances are enabled.
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

    // Open the studio.
    await page.click("[data-testid='profile-edit-avatar']");
    await expect(
      page.locator("[data-testid='avatar-uploader']"),
    ).toBeVisible();
    await expect(page.locator("[data-testid='studio-new-photo']")).toBeVisible();

    // Gallery → reposition. The hidden file input is what the Hub's
    // "From gallery" row triggers; setting files directly bypasses the
    // OS picker.
    await page
      .locator("[data-testid='avatar-file-input']")
      .setInputFiles({
        name: "fixture.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
    await expect(
      page.locator("[data-testid='studio-reposition']"),
    ).toBeVisible();
    await page.click("[data-testid='studio-reposition-confirm']");

    // Style → pick a non-default frame + ring + save.
    await expect(page.locator("[data-testid='studio-style']")).toBeVisible();
    await page.click("[data-testid='studio-frame-tag']");
    await expect(
      page.locator("[data-testid='studio-frame-tag']"),
    ).toHaveAttribute("aria-pressed", "true");
    await page.click("[data-testid='studio-ring-scientific']");
    await expect(
      page.locator("[data-testid='studio-ring-scientific']"),
    ).toHaveAttribute("aria-pressed", "true");

    await page.click("[data-testid='studio-style-save']");

    // Studio surfaces the success step on save.
    await expect(page.locator("[data-testid='studio-saved']")).toBeVisible();

    // Done returns us to the profile detail page; the avatar should
    // wear the new stamp. The `<Avatar>` itself doesn't surface a
    // data-testid by default — the EditableAvatar's pencil button does,
    // and re-entering the studio is the most robust proof the saved
    // state survived a remount.
    await page.click("[data-testid='studio-saved-done']");
    await expect(
      page.locator("[data-testid='avatar-uploader']"),
    ).toHaveCount(0);

    // Re-open the studio — the Hub should now show the "Use my X
    // monogram" clear row (only renders when customAvatarUrl is set),
    // confirming the upload completed.
    await page.click("[data-testid='profile-edit-avatar']");
    await expect(
      page.locator("[data-testid='studio-clear-photo']"),
    ).toBeVisible();
    // The "Style stamp" row should be enabled (we have a photo now).
    await expect(
      page.locator("[data-testid='studio-style-stamp']"),
    ).toBeEnabled();

    // Re-entering Style should reflect the previously saved frame + ring.
    await page.click("[data-testid='studio-style-stamp']");
    await expect(page.locator("[data-testid='studio-style']")).toBeVisible();
    await expect(
      page.locator("[data-testid='studio-frame-tag']"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator("[data-testid='studio-ring-scientific']"),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
