import { test, expect, type Page } from "@playwright/test";
import { isTestAuthMode } from "./helpers/auth";

/**
 * Match share-link — PR 8-D.
 *
 * Drives the full owner flow through the UI (complete a 7WD match →
 * open share dialog → copy URL → revoke), then verifies:
 *  - the public `/share/:token` page renders the right scoreboard
 *    without leaking owner identity,
 *  - chat-unfurl meta tags (OG) land in `<head>`,
 *  - revoking the link kills the public page.
 */

const stamp = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function signUpFresh(page: Page, label: string) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("input[name='email']");
  await page.fill("input[name='name']", `Share ${label} ${stamp()}`);
  await page.fill(
    "input[name='email']",
    `share-${label}-${stamp()}@example.com`,
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

async function completeMatchAsViewer(
  page: Page,
  opts: { myName: string; opponentName: string },
): Promise<{ matchUrl: string }> {
  await page.goto("/games/7-wonders-duel/new");
  await page.waitForLoadState("domcontentloaded");
  await page.fill("[data-testid='new-match-player-0']", opts.myName);
  await page.fill("[data-testid='new-match-player-1']", opts.opponentName);
  await page.click("[data-testid='new-match-submit']");
  await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
  const matchUrl = page.url();

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

  // Match completion is an optimistic mutation: the UI flips to
  // COMPLETED before the server has the PUT. The share-token POST
  // is server-side gated on status === "COMPLETED", so explicitly
  // wait for the completion PUT to land before opening the dialog.
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

  return { matchUrl };
}

test.describe("match share-link", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(
    !isTestAuthMode(),
    "Skipped: needs test-mode email/password sign-up for a fresh user",
  );

  test("owner shares a 7WD match → public page renders + OG tags present", async ({
    page,
    context,
  }) => {
    await signUpFresh(page, "share");
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;
    const opponentName = `Hugo-${stamp()}`;
    await completeMatchAsViewer(page, { myName: me, opponentName });

    // Open the share dialog from the SWD completion screen.
    await page.click("[data-testid='swd-share-match']");
    const dialog = page.locator("[data-testid='share-dialog']");
    await expect(dialog).toBeVisible();
    const urlInput = page.locator("[data-testid='share-dialog-url']");
    await expect(urlInput).toBeVisible();
    const shareUrl = await urlInput.inputValue();
    expect(shareUrl).toMatch(/\/share\/[a-z0-9]+/i);

    // Public page in a fresh, unauthenticated context.
    const anon = await context.browser()!.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(shareUrl);
    await anonPage.waitForLoadState("domcontentloaded");

    const summary = anonPage.locator("[data-testid='share-summary']");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(me);
    await expect(summary).toContainText(opponentName);
    await expect(
      anonPage.locator("[data-testid='share-winner-line']"),
    ).toContainText(me);

    // OG meta — injected SSR-side from the share-og helper. Read the
    // raw HTML directly (not the live DOM) so we exercise the SSR
    // pipeline that chat apps would hit.
    const html = await anonPage.evaluate(() =>
      document.documentElement.outerHTML,
    );
    expect(html).toMatch(/<meta property="og:title"/);
    expect(html).toMatch(/<meta property="og:description"/);
    expect(html).toMatch(/<meta property="og:url"/);

    await anon.close();
  });

  test("revoke kills the public link", async ({ page, context }) => {
    await signUpFresh(page, "revoke");
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;
    await completeMatchAsViewer(page, {
      myName: me,
      opponentName: `Iris-${stamp()}`,
    });

    await page.click("[data-testid='swd-share-match']");
    const urlInput = page.locator("[data-testid='share-dialog-url']");
    await expect(urlInput).toBeVisible();
    const shareUrl = await urlInput.inputValue();

    // Sanity: public page works pre-revoke.
    const before = await context.request.get(shareUrl);
    expect(before.status()).toBe(200);

    // Revoke from the dialog.
    await page.click("[data-testid='share-dialog-revoke']");
    await expect(page.locator("[data-testid='share-dialog']")).toHaveCount(0);

    // Now any direct hit on the public URL renders the not-found state
    // (the SPA still serves the shell, but the SPA reads /api/share/:token
    // which 404s).
    const anon = await context.browser()!.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(shareUrl);
    await anonPage.waitForLoadState("domcontentloaded");
    await expect(
      anonPage.locator("[data-testid='share-not-found']"),
    ).toBeVisible();
    await anon.close();
  });

  test("share dialog re-opens with the existing token (idempotent UX)", async ({
    page,
  }) => {
    await signUpFresh(page, "reopen");
    const sessionRes = await page.request.get("/api/auth/get-session");
    const session = await sessionRes.json();
    const me = session.user.name as string;
    await completeMatchAsViewer(page, {
      myName: me,
      opponentName: `Jules-${stamp()}`,
    });

    await page.click("[data-testid='swd-share-match']");
    const firstInput = page.locator("[data-testid='share-dialog-url']");
    await expect(firstInput).toBeVisible();
    const firstUrl = await firstInput.inputValue();
    await page.click("[data-testid='share-dialog-close']");
    await expect(page.locator("[data-testid='share-dialog']")).toHaveCount(0);

    await page.click("[data-testid='swd-share-match']");
    const secondInput = page.locator("[data-testid='share-dialog-url']");
    await expect(secondInput).toBeVisible();
    const secondUrl = await secondInput.inputValue();
    expect(secondUrl).toBe(firstUrl);
  });
});
