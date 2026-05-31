import { test, expect } from "@playwright/test";
import { createProfile, signUpContext } from "./helpers/api";
import { openProfile } from "./helpers/ui";

/**
 * Feedback-round polish: the link-section explainer used to render
 * as a bulky paragraph above the Show QR / Scan QR buttons. It's now
 * collapsed behind an info-icon button next to the section title.
 * Tapping the icon toggles the explainer in / out.
 *
 * Asserts the toggle behaviour from a real DOM tap (the previous
 * `title=` tooltip approach silently did nothing on click — that
 * regression is what this test guards against).
 */
test.describe("Profile detail — link section explainer toggle", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("info icon toggles the explainer paragraph in and out", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    try {
      await signUpContext(ctx);

      // Seed an unclaimed friend-profile (the link UI only renders on
      // unclaimed + owner — the explainer lives in that branch).
      const aliasSuffix = Math.random().toString(36).slice(2, 7);
      const friend = await createProfile(ctx.request, `Friend-${aliasSuffix}`);

      const page = await ctx.newPage();
      // All link affordances now live inside the profile editor —
      // open it via the helper so the info button is in the DOM.
      await openProfile(page, friend.id);

      const infoButton = page.locator("[data-testid='profile-link-info']");
      await expect(infoButton).toBeVisible();
      // Closed on first paint — paragraph not rendered, aria-expanded false.
      await expect(infoButton).toHaveAttribute("aria-expanded", "false");
      const explainer = page.locator("#profile-link-explainer");
      await expect(explainer).toHaveCount(0);

      // Open.
      await infoButton.click();
      await expect(infoButton).toHaveAttribute("aria-expanded", "true");
      await expect(explainer).toBeVisible();
      // Non-empty text content — guards against an empty render that
      // would still satisfy `toBeVisible()`.
      const text = (await explainer.textContent())?.trim() ?? "";
      expect(text.length).toBeGreaterThan(0);

      // Close again.
      await infoButton.click();
      await expect(infoButton).toHaveAttribute("aria-expanded", "false");
      await expect(explainer).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
