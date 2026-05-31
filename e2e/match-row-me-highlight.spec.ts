import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

/**
 * Phase 7 (revised) — "this is me" highlight on the unified
 * MatchHistoryRow. The feedback-round decision was to render the
 * teal edge tab + Highlighter swipe + teal avatar ring on BOTH
 * surfaces (game-history list AND profile-detail) wherever the
 * signed-in user is a participant, so the visual stays consistent.
 *
 * We exercise both surfaces against the same signed-in user with one
 * match seeded against their self-Profile so the row's `linkedUserId`
 * matches the viewer's id.
 */

test.describe("MatchHistoryRow — me-highlight", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function signUpAndSeedMatch(page: Page) {
    await login(page);
    // Pull the signed-in user's display name out of the session so we
    // can type it into slot 0 and pick the matching self-Profile from
    // the suggestion list. That's what threads `linkedUserId === me`
    // through to the Player row and triggers the me-highlight.
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const ownName: string = session.user.alias || session.user.name;

    const stamp = Math.random().toString(36).slice(2, 8);
    await page.goto("/games/skull-king/new");
    await page.waitForLoadState("domcontentloaded");
    // Slot 0: type the viewer's own name to surface the self-Profile in
    // suggestions, then click the matching suggestion so the form
    // submits with the self-Profile's id (linkedUserId === viewerId).
    await page.fill("[data-testid='new-match-player-0']", ownName);
    await page
      .locator(
        "[data-testid='new-match-suggestions-0'] [data-suggestion-for]",
      )
      .first()
      .click();
    await page.fill(
      "[data-testid='new-match-player-1']",
      `Other-${stamp}`,
    );
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
  }

  test("highlighted on both /games/:slug history and /players/:profileId", async ({
    page,
  }) => {
    await signUpAndSeedMatch(page);

    // History page: the row should carry data-me="true".
    await page.goto("/games/skull-king");
    await page.waitForLoadState("domcontentloaded");
    const historyRow = page
      .locator("[data-testid^='match-history-row-']")
      .first();
    await expect(historyRow).toBeVisible();
    await expect(historyRow).toHaveAttribute("data-me", "true");

    // Profile detail page: same match's row also carries data-me
    // (the suppression rule from the original handoff was relaxed
    // in the feedback round — the highlight is now consistent
    // across surfaces wherever the viewer is a participant).
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator("[data-testid='player-row']")
      .first()
      .click();
    await page.waitForURL(/\/players\/[a-z0-9-]+$/);

    const profileRow = page
      .locator("[data-testid^='match-history-row-']")
      .first();
    await expect(profileRow).toBeVisible();
    await expect(profileRow).toHaveAttribute("data-me", "true");
  });
});
