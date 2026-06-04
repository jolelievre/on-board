import { test, expect, type Page } from "@playwright/test";
import { isTestAuthMode } from "./helpers/auth";

/**
 * Match delete — PR 8-G.
 *
 * Drives the creator-side flow through the UI:
 *   1. Sign up + complete a 7WD match.
 *   2. From the match-detail page, open the overflow menu → confirm.
 *   3. The router navigates back to the per-game history.
 *   4. The match no longer appears in the history list.
 *
 * The server-side tombstone + linked-friend propagation are covered
 * via manual smoke on the integration preview; doing that in CI would
 * require a multi-account fixture beyond what this single-user spec
 * needs to assert.
 */

const stamp = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function signUpFresh(page: Page, label: string) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("input[name='email']");
  await page.fill("input[name='name']", `Delete ${label} ${stamp()}`);
  await page.fill(
    "input[name='email']",
    `delete-${label}-${stamp()}@example.com`,
  );
  await page.fill("input[name='password']", "testpassword123");
  await page.click("button[type='submit']");
  await page.waitForURL("**/games", { timeout: 10000 });
}

async function resolvePlayerId(page: Page, name: string): Promise<string> {
  return page
    .locator(`[data-testid^='score-grid-player-'] >> text=${name}`)
    .first()
    .evaluate((el) =>
      el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
    );
}

async function setScore(
  page: Page,
  playerId: string,
  category: string,
  value: number,
) {
  const input = page.locator(
    `[data-testid='score-input-${playerId}-${category}']`,
  );
  await input.fill(String(value));
  await input.blur();
}

async function createAndCompleteMatch(
  page: Page,
  opts: { myName: string; opponentName: string },
): Promise<{ matchUrl: string; matchId: string }> {
  await page.goto("/games/7-wonders-duel/new");
  await page.waitForLoadState("domcontentloaded");
  await page.fill("[data-testid='new-match-player-0']", opts.myName);
  await page.fill("[data-testid='new-match-player-1']", opts.opponentName);
  await page.click("[data-testid='new-match-submit']");
  await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
  const matchUrl = page.url();
  const matchId = matchUrl.match(/\/matches\/([a-z0-9-]+)/i)![1];

  const myId = await resolvePlayerId(page, opts.myName);
  const oppId = await resolvePlayerId(page, opts.opponentName);
  await setScore(page, myId, "civil", 25);
  await setScore(page, oppId, "civil", 18);

  await page.waitForResponse(
    (r) =>
      /\/api\/matches\/[^/]+\/scores$/.test(r.url()) &&
      r.request().method() === "PATCH" &&
      r.ok(),
    { timeout: 5000 },
  );

  const completionPut = page.waitForResponse(
    (r) =>
      /\/api\/matches\/[^/]+$/.test(r.url()) &&
      r.request().method() === "PUT" &&
      r.ok(),
    { timeout: 8000 },
  );
  await page.click("[data-testid='complete-match']");
  await expect(page.locator("[data-testid='winner-banner']")).toBeVisible();
  await completionPut;

  return { matchUrl, matchId };
}

test.describe("match delete", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(
    !isTestAuthMode(),
    "Skipped: needs test-mode email/password sign-up for a fresh user",
  );

  test("owner deletes a completed 7WD match → row disappears from history", async ({
    page,
  }) => {
    await signUpFresh(page, "match");
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;
    const opponentName = `Lana-${stamp()}`;
    const { matchId } = await createAndCompleteMatch(page, {
      myName: me,
      opponentName,
    });

    // Sanity: the row is in history before deletion.
    await page.goto("/games/7-wonders-duel");
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.locator(`[data-testid='match-history-row-${matchId}']`),
    ).toBeVisible();

    // Navigate back to the match detail to delete.
    await page.click(`[data-testid='match-history-row-${matchId}']`);
    await page.waitForURL(`**/matches/${matchId}`);

    // The overflow trigger is in the page Header — creator-only.
    const trigger = page.locator("[data-testid='match-delete-trigger']");
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.locator("[data-testid='delete-match-dialog']");
    await expect(dialog).toBeVisible();

    // Cancel first — the dialog should close and the match should still
    // be there (defensive: dismissing the dialog must not be destructive).
    await page.click("[data-testid='delete-match-cancel']");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(`/matches/${matchId}`);

    // Now confirm. The mutation deletes locally and queues the server
    // DELETE; the page navigates back to the per-game history.
    await trigger.click();
    await page.click("[data-testid='delete-match-confirm']");
    await page.waitForURL("**/games/7-wonders-duel");

    // The history list no longer carries the deleted row.
    await expect(
      page.locator(`[data-testid='match-history-row-${matchId}']`),
    ).toHaveCount(0);

    // Poll the server-side `/api/matches/:id` until it 404s — proves
    // the queued DELETE drained and tombstoned server-side. Pulling
    // status through `page.request` borrows the page's auth cookies so
    // we exercise the same auth context the SPA uses.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/matches/${matchId}`);
          return res.status();
        },
        { timeout: 10_000, intervals: [200, 400, 800] },
      )
      .toBe(404);

    // A fresh navigation to the now-tombstoned match URL falls through
    // to the not-found state — the server 404s the active read, and the
    // local mirror is gone.
    await page.goto(`/matches/${matchId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("text=Match not found")).toBeVisible();
  });
});
