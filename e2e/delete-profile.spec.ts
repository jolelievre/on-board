import { test, expect, type Page } from "@playwright/test";
import { isTestAuthMode } from "./helpers/auth";

/**
 * Profile delete — PR 8-G.
 *
 * Covers the load-bearing claim from the design discussion: deleting
 * an unclaimed profile that participated in a multi-player match must
 * NOT degrade the historical scoreboard. The match keeps showing the
 * deleted profile's alias because the `Player.profile` snapshot is
 * preserved on the Player row (server-side and in the local Dexie
 * mirror).
 *
 * The linked-profile path (auto-unlink before tombstone) is covered
 * via manual smoke on the integration preview — a multi-account
 * fixture in CI would substantially expand the suite for a flow that
 * already shares the bulk of its machinery with the existing
 * `unlinkProfile` E2E coverage in `link-qr.spec.ts`.
 */

const stamp = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function signUpFresh(page: Page, label: string) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("input[name='email']");
  await page.fill("input[name='name']", `Profile ${label} ${stamp()}`);
  await page.fill(
    "input[name='email']",
    `profile-${label}-${stamp()}@example.com`,
  );
  await page.fill("input[name='password']", "testpassword123");
  await page.click("button[type='submit']");
  await page.waitForURL("**/games", { timeout: 10000 });
}

test.describe("profile delete", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(
    !isTestAuthMode(),
    "Skipped: needs test-mode email/password sign-up for a fresh user",
  );

  test("delete unclaimed profile → Players list updates, historical match still renders the alias", async ({
    page,
  }) => {
    await signUpFresh(page, "delete");
    const opponentName = `Mira-${stamp()}`;

    // Create a Skull King match with the opponent — auto-creates an
    // unclaimed Profile for them at submit. We pick Skull King because
    // it surfaces the embedded profile in the scoreboard row, which
    // is the snapshot path we want to verify post-deletion.
    await page.goto("/games/skull-king/new");
    await page.waitForLoadState("domcontentloaded");
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;
    await page.fill("[data-testid='new-match-player-0']", me);
    await page.fill("[data-testid='new-match-player-1']", opponentName);
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
    const matchUrl = page.url();
    const matchId = matchUrl.match(/\/matches\/([a-z0-9-]+)/i)![1];

    // Open the Players tab — the unclaimed profile shows up after the
    // create POST drains.
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    const row = page.locator("[data-testid='player-row']", {
      hasText: opponentName,
    });
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(/\/players\/[a-z0-9-]+$/);

    // Enter edit mode to reveal the destructive action — it lives at
    // the bottom of the editor body, paired with the merge action.
    await page.click("[data-testid='profile-edit-avatar']");
    await expect(page.locator("[data-testid='profile-editor']")).toBeVisible();
    await page.click("[data-testid='profile-delete-action']");

    const dialog = page.locator("[data-testid='delete-profile-dialog']");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(opponentName);

    // Confirm the delete. Mutations.deleteProfile writes locally +
    // queues `DELETE /api/profiles/:id`; the page navigates to
    // /players. The DELETE replay is fire-and-forget; we verify the
    // server tombstone via the polling assertion below.
    await page.click("[data-testid='delete-profile-confirm']");
    await page.waitForURL("**/players");

    // Players list no longer carries the deleted profile.
    await expect(
      page.locator("[data-testid='player-row']", { hasText: opponentName }),
    ).toHaveCount(0);

    // Server-side tombstone landed: `/api/profiles` no longer includes
    // this profile (the GET filter ignores tombstoned rows on the
    // active-list path). Poll because the queued DELETE replays
    // asynchronously off the local mutation.
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/profiles");
          if (!res.ok()) return -1;
          const rows = (await res.json()) as { alias: string }[];
          return rows.some((r) => r.alias === opponentName);
        },
        { timeout: 10_000, intervals: [200, 400, 800] },
      )
      .toBe(false);

    // Load-bearing assertion: the historical match still renders the
    // opponent's alias verbatim. The embedded `Player.profile`
    // snapshot drives the scoreboard, so deleting the canonical
    // Profile shouldn't degrade the rendering.
    await page.goto(`/matches/${matchId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(opponentName).first()).toBeVisible();
  });

  test("delete dialog cancel preserves the profile", async ({ page }) => {
    await signUpFresh(page, "cancel");
    const opponentName = `Nira-${stamp()}`;

    // Quick profile creation via the new-match form.
    await page.goto("/games/skull-king/new");
    await page.waitForLoadState("domcontentloaded");
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;
    await page.fill("[data-testid='new-match-player-0']", me);
    await page.fill("[data-testid='new-match-player-1']", opponentName);
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);

    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    const row = page.locator("[data-testid='player-row']", {
      hasText: opponentName,
    });
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(/\/players\/[a-z0-9-]+$/);
    const detailUrl = page.url();

    await page.click("[data-testid='profile-edit-avatar']");
    await page.click("[data-testid='profile-delete-action']");
    const dialog = page.locator("[data-testid='delete-profile-dialog']");
    await expect(dialog).toBeVisible();

    // Cancel — dialog closes, profile stays put.
    await page.click("[data-testid='delete-profile-cancel']");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(detailUrl);

    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.locator("[data-testid='player-row']", { hasText: opponentName }),
    ).toBeVisible();
  });
});
