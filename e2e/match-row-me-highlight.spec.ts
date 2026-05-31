import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

/**
 * Phase 7 — "this is me" highlight on the unified MatchHistoryRow.
 *
 * Rule from the design handoff: the teal edge tab + Highlighter swipe +
 * teal avatar ring only appear in match-history lists, NOT on a
 * profile-detail page (where every row is already that person, so
 * highlighting is noise).
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

  test("highlighted in /games/:slug history, not on /players/:profileId", async ({
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

    // Profile detail page: the same match's row must NOT carry data-me.
    // We walk through the Players tab so the route is bound to the
    // self-Profile (or any owned profile). Self-Profile is excluded
    // from the Players listing, so we use the friend profile instead —
    // viewing the friend's matches via their profile, where the friend
    // is the row's subject, the viewer is still in the players list
    // (it's a friend-vs-me match), and the design rule says no row is
    // highlighted on a profile-detail surface.
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
    await expect(profileRow).not.toHaveAttribute("data-me", "true");
  });
});
