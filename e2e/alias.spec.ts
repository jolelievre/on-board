import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

/**
 * Alias feature tests.
 *
 * Each test signs up a fresh user (no shared auth state) so setting the
 * alias doesn't bleed into the rest of the suite.
 */
test.describe("Alias — settings + propagation", () => {
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

  test("editing the alias shows the saved badge and persists across reload", async ({
    page,
  }) => {
    await signUpFresh(page);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    const input = page.locator("[data-testid='settings-alias-input']");
    await expect(input).toHaveValue("");
    await input.fill("Jo");
    await input.blur();

    const savedBadge = page.locator("[data-testid='settings-alias-saved']");
    await expect(savedBadge).toBeVisible();

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.locator("[data-testid='settings-alias-input']"),
    ).toHaveValue("Jo");
  });

  test("clearing the alias falls back to the full name in the self chip", async ({
    page,
  }) => {
    const user = await signUpFresh(page);

    // Set alias via the UI
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='settings-alias-input']").fill("Jo");
    await page.locator("[data-testid='settings-alias-input']").blur();
    await expect(
      page.locator("[data-testid='settings-alias-saved']"),
    ).toBeVisible();

    // Self chip should show the alias
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='new-match-player-0']");
    await expect(
      page.locator("[data-testid='new-match-suggestion-0-Jo']"),
    ).toBeVisible();
    await expect(
      page.locator(
        `[data-testid='new-match-suggestion-0-${user.name}']`,
      ),
    ).toHaveCount(0);

    // Clear the alias
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='settings-alias-input']").fill("");
    await page.locator("[data-testid='settings-alias-input']").blur();
    // Wait for the PATCH to round-trip before navigating. The savedBadge
    // means updateProfile resolved and refreshLocalAliases completed; the
    // suggestion list's self chip reads from authClient.useSession(), which
    // updates reactively after the PATCH.
    await expect(
      page.locator("[data-testid='settings-alias-saved']"),
    ).toBeVisible();

    // Wait for the server to actually report the cleared alias before
    // navigating. The savedBadge means the PATCH 200 came back, but
    // better-auth's per-process session cache can still serve the old user
    // payload to the next /api/players/suggestions request for a brief
    // window — observed flake when parallel workers contend for the dev
    // server. Poll the API directly so the UI assertion below has stable
    // state to render against.
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/players/suggestions");
          const list = (await res.json()) as { name: string; isSelf: boolean }[];
          return list.find((s) => s.isSelf)?.name;
        },
        { timeout: 10000 },
      )
      .toBe(user.name);

    // Self chip falls back to the full name.
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='new-match-player-0']");
    await expect(
      page.locator(
        `[data-testid='new-match-suggestion-0-${user.name}']`,
      ),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='new-match-suggestion-0-Jo']"),
    ).toHaveCount(0);
  });

  test("editing the alias via the Players tab updates the new-match self suggestion", async ({
    page,
  }) => {
    // Reproduces the bug where renaming via /players/<self> didn't
    // refresh the new-match self suggestion because the legacy hook
    // read the alias from the auth session (only updated by the
    // Settings page) instead of from Dexie's self-Profile (updated by
    // patchProfile too). 6-B's picker reads from Dexie directly, so the
    // refresh is automatic — this test guards against regression.
    await signUpFresh(page);

    // Open the self-Profile detail page. The list is sorted with self
    // pinned at the top, so the first row is the self entry.
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='player-row']").first().click();
    await page.waitForURL(/\/players\/[^/?#]+$/);

    const aliasInput = page.locator("[data-testid='profile-alias-input']");
    await expect(aliasInput).toBeVisible();
    await aliasInput.fill("Captain");
    await aliasInput.blur();
    await expect(
      page.locator("[data-testid='profile-alias-saved']"),
    ).toBeVisible();

    // The new alias must now appear as the self suggestion chip in the
    // new-match form, just like it does when edited via Settings.
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='new-match-player-0']");
    await expect(
      page.locator("[data-testid='new-match-suggestion-0-Captain']"),
    ).toBeVisible();
  });

  test("alias retroactively updates match history for linked players", async ({
    page,
  }) => {
    const user = await signUpFresh(page);

    // Create the match through the in-app UI flow rather than POSTing to
    // /api/matches directly. This way the test exercises the same code path
    // a real user takes — including the Dexie write + sync-queue enqueue
    // that mutations.createMatch performs — instead of bypassing it.
    // Clicking the self-suggestion chip is what attaches the player to the
    // User row (sends userId), so the alias propagation logic has something
    // to link to.
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");

    await page.click("[data-testid='new-match-player-0']");
    await page.click(
      `[data-testid='new-match-suggestion-0-${user.name}']`,
    );
    await page.fill("[data-testid='new-match-player-1']", "Friend");
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[^/?#]+$/);

    // Now change the alias AFTER the match was created.
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='settings-alias-input']").fill("Jo");
    await page.locator("[data-testid='settings-alias-input']").blur();
    await expect(
      page.locator("[data-testid='settings-alias-saved']"),
    ).toBeVisible();

    // Use client-side navigation (BottomNav → game card) instead of
    // page.goto so the in-memory React/Dexie state carries over. After
    // refreshLocalAliases updates Dexie's player.user.alias rows, the
    // game detail's useLiveQuery picks up the new alias on next render.
    await page.click("nav[aria-label='Primary'] a[href='/games']");
    await page.waitForURL("**/games");
    await page.click("a[href='/games/7-wonders-duel']");
    await page.waitForURL("**/games/7-wonders-duel");

    const history = page.locator("[data-testid='match-history']");
    await expect(history).toBeVisible();
    await expect(history).toContainText("Jo");
    await expect(history).not.toContainText(user.name);
  });

  test("alias propagates into the in-progress match score grid", async ({
    page,
  }) => {
    const user = await signUpFresh(page);

    // Set alias first so the match is created with already-aliased display
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("[data-testid='settings-alias-input']").fill("Jo");
    await page.locator("[data-testid='settings-alias-input']").blur();
    await expect(
      page.locator("[data-testid='settings-alias-saved']"),
    ).toBeVisible();

    // Start a new match — pick the self chip for player 0
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");
    await page.click("[data-testid='new-match-player-0']");
    await page.click("[data-testid='new-match-suggestion-0-Jo']");
    await page.fill("[data-testid='new-match-player-1']", "Friend");
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);

    // The score grid's player block should show the alias, not the
    // user's full name
    const scoreGrid = page.locator("[data-testid='score-grid']");
    await expect(scoreGrid).toContainText("Jo");
    await expect(scoreGrid).not.toContainText(user.name);
  });
});
