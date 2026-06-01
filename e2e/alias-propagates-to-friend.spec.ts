import {
  test,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  createProfile,
  getMe,
  mintLinkToken,
  signUpContext,
} from "./helpers/api";

/**
 * Phase 6-E follow-up: when A renames an unclaimed profile they own
 * (e.g. "Charlie" — a friend who isn't signed up), every device that
 * sees a shared match including that profile but doesn't own a
 * Profile for the same person must eventually see the new alias.
 *
 * The scenario is anchored in the embedded snapshot path. Because B
 * has no Profile pointing at Charlie (Charlie is unclaimed),
 * `displayProfileName` on B's device falls through `ownedIndex` to
 * the `Player.profile.alias` snapshot — that snapshot lives on the
 * Match row, and pull-sync's `?since=` filter requires
 * `Match.updatedAt` to advance for B to re-fetch it. Without the
 * bump in `PATCH /api/profiles/:id`, the snapshot would stay frozen
 * at "Charlie" on B's device forever after A renamed.
 *
 * Setup: A and B bilaterally link (so A can include B in a match
 * via the linked profile). A creates a third, unclaimed profile
 * "Charlie" and plays a Skull King match with [A's self, B, Charlie].
 * B is the friend whose snapshot must refresh.
 */
test.describe("Profile alias propagation to friend devices", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // The whole flow — two signups, link, match create, pull, rename,
  // re-pull — comfortably exceeds the default 30s test timeout.
  test.setTimeout(120_000);

  /** Wait for the friend's match-history view to render the expected
   * alias. Drives the same code path a real user would: reload once
   * to remount the layout (which triggers `usePullSyncBackground`'s
   * routine pull), then watch the reactive Dexie-backed UI re-render
   * as pull-sync writes the refreshed `Player.profile.alias`
   * snapshot. No test hooks. */
  async function awaitFriendSeesAlias(
    page: Page,
    expectedAlias: string,
  ): Promise<void> {
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect
      .poll(
        async () => {
          const text = await page
            .locator("body")
            .innerText({ timeout: 5_000 })
            .catch(() => "");
          return text.includes(expectedAlias);
        },
        { timeout: 60_000, intervals: [500, 1_000, 1_500, 2_000, 3_000] },
      )
      .toBeTruthy();
  }

  test("A renames an unclaimed profile → B sees the new alias after pull", async ({
    browser,
  }) => {
    const aCtx: BrowserContext = await browser.newContext();
    const bCtx: BrowserContext = await browser.newContext();

    try {
      await signUpContext(aCtx);
      await signUpContext(bCtx);
      const aMe = await getMe(aCtx.request);
      const bMe = await getMe(bCtx.request);

      // Bilateral link between A and B so A can include B in a match
      // and B inherits visibility through their owned linked profile.
      const aBProfile = await createProfile(aCtx.request, "B-temp");
      const bAProfile = await createProfile(bCtx.request, "A-temp");
      const bToken = await mintLinkToken(bCtx.request, bAProfile.id);
      const linkRes = await aCtx.request.post(
        `/api/profiles/${aBProfile.id}/link`,
        { data: { token: bToken } },
      );
      expect(linkRes.ok()).toBeTruthy();
      const linkBody = (await linkRes.json()) as { status: string };
      expect(linkBody.status).toBe("linked");

      // A creates the unclaimed third-party profile whose alias
      // change is the subject of the test.
      const initialAlias = `Charlie-${Math.random().toString(36).slice(2, 6)}`;
      const charlie = await createProfile(aCtx.request, initialAlias);

      // A plays a Skull King match with [self, B (linked profile),
      // Charlie]. Skull King takes 2-8 players. B has visibility
      // because aBProfile.linkedUserId === bMe.id.
      const aPage = await aCtx.newPage();
      await aPage.goto("/games/skull-king/new");
      await aPage.waitForLoadState("domcontentloaded");
      await aPage.click("[data-testid='new-match-add-player']");

      // Slot 0: self chip
      const aName = (await getMe(aCtx.request)).name;
      await aPage.click("[data-testid='new-match-player-0']");
      await aPage
        .locator(`[data-testid='new-match-suggestion-0-${aName}']`)
        .click();
      // Slot 1: pick B's linked profile by typing its alias
      await aPage.click("[data-testid='new-match-player-1']");
      await aPage.fill("[data-testid='new-match-player-1']", "B-temp");
      const bChip = aPage.locator(
        "[data-testid='new-match-suggestion-1-B-temp']",
      );
      await expect(bChip).toBeVisible({ timeout: 5_000 });
      await bChip.click();
      // Slot 2: pick Charlie
      await aPage.click("[data-testid='new-match-player-2']");
      await aPage.fill("[data-testid='new-match-player-2']", initialAlias);
      const charlieChip = aPage.locator(
        `[data-testid='new-match-suggestion-2-${initialAlias}']`,
      );
      await expect(charlieChip).toBeVisible({ timeout: 5_000 });
      await charlieChip.click();
      await aPage.click("[data-testid='new-match-submit']");
      await aPage.waitForURL(/\/matches\/[a-z0-9-]+/i, { timeout: 10_000 });

      // B's first pull should expose the match and Charlie's
      // current alias on the Skull King history page. Charlie has no
      // linked-user override, no B-owned representation — B reads
      // the alias from the embedded snapshot.
      const bPage = await bCtx.newPage();
      await bPage.goto("/games/skull-king");
      await bPage.waitForLoadState("domcontentloaded");
      await awaitFriendSeesAlias(bPage, initialAlias);

      // A renames Charlie via the profile detail page. This routes
      // through `PATCH /api/profiles/:id`, which bumps Match.updatedAt
      // for every Match where Charlie is a player.
      const renamedAlias = `Chuck-${Math.random().toString(36).slice(2, 6)}`;
      await aPage.goto(`/players/${charlie.id}`);
      await aPage.waitForLoadState("domcontentloaded");
      // Alias editor now lives inside the profile editor — open the
      // editor via the pencil first.
      await aPage.click("[data-testid='profile-edit-avatar']");
      await expect(
        aPage.locator("[data-testid='profile-editor']"),
      ).toBeVisible({ timeout: 5_000 });
      const aliasInput = aPage.locator(
        "[data-testid='profile-alias-input']",
      );
      await aliasInput.fill(renamedAlias);
      await aliasInput.blur();
      await expect(
        aPage.locator("[data-testid='profile-alias-saved']"),
      ).toBeVisible({ timeout: 5_000 });

      // After the Match.updatedAt bump, B's next pull brings the
      // refreshed embedded Player.profile.alias snapshot down.
      await awaitFriendSeesAlias(bPage, renamedAlias);

      // Sanity: A and B are distinct users — the cross-context
      // wiring isn't accidentally reusing one session.
      expect(aMe.id).not.toBe(bMe.id);
    } finally {
      await aCtx.close();
      await bCtx.close();
    }
  });
});
