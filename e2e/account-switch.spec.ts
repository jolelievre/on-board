import { test, expect, type Page } from "@playwright/test";
import { isTestAuthMode } from "./helpers/auth";

/**
 * Cross-account leak regression — PR 8-B.
 *
 * Background: Phase 5c made Dexie the local source of truth and every
 * UI hook reads via `useLiveQuery`. The server filters
 * `GET /api/matches` by viewer visibility, but Dexie holds whatever
 * was pulled — including a previous user's rows. Signing out and
 * signing in as someone else (same device) used to surface the prior
 * user's matches in `/games/<slug>` because the client trusted Dexie
 * without re-filtering by the current viewer.
 *
 * PR 8-B's fix is `src/client/lib/visibility.ts` plus a
 * viewer-required signature on every read hook. This spec proves the
 * bug doesn't return: user B, signing in fresh on the same browser
 * context where A just played a match, sees an empty history.
 *
 * Driven through the UI — clicks, fills, navigation — not the API.
 * The bug exists at the read-hook integration boundary, so an
 * API-only test would pass while the screens still leaked.
 */

const stamp = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function signUpFresh(page: Page, label: string) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("input[name='email']");
  await page.fill("input[name='name']", `Switch ${label} ${stamp()}`);
  await page.fill(
    "input[name='email']",
    `switch-${label}-${stamp()}@example.com`,
  );
  await page.fill("input[name='password']", "testpassword123");
  await page.click("button[type='submit']");
  await page.waitForURL("**/games", { timeout: 10000 });
}

async function signOut(page: Page) {
  await page.goto("/settings");
  await page.waitForLoadState("domcontentloaded");
  await page.click("text=Sign out");
  await page.waitForURL("/", { timeout: 10000 });
}

test.describe("Account switch on shared device — matches do not leak", () => {
  // The bug surfaces specifically when one browser context carries
  // Dexie data from a prior user; auto-loaded auth state from
  // `e2e/.auth/state.json` is irrelevant — start fresh.
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(
    !isTestAuthMode(),
    "Skipped: account-switch repro needs test-mode email/password sign-up for fresh users on demand",
  );

  test("user B does not see user A's matches after signing in", async ({
    page,
  }) => {
    // ── User A: sign up, create a 7WD match, sign out ─────────────
    await signUpFresh(page, "A");
    await page.goto("/games/7-wonders-duel/new");
    await page.waitForLoadState("domcontentloaded");

    const s = stamp();
    await page.fill("[data-testid='new-match-player-0']", `LeakA1-${s}`);
    await page.fill("[data-testid='new-match-player-1']", `LeakA2-${s}`);
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);

    // Capture A's match id for the rematch-leak assertion below.
    const matchUrl = page.url();
    const matchIdMatch = /\/matches\/([a-z0-9-]+)/i.exec(matchUrl);
    if (!matchIdMatch) throw new Error(`could not parse match id from ${matchUrl}`);
    const aMatchId = matchIdMatch[1];

    // Sanity check: A actually has the match in their history before
    // we switch users. Without this the post-switch assertion below
    // could pass for the wrong reason (e.g. the form silently failed).
    await page.goto("/games/7-wonders-duel");
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.locator(
        "[data-testid='match-history'] >> [data-testid^='match-history-row-']",
      ),
    ).toHaveCount(1);

    await signOut(page);

    // ── User B: sign up in the SAME browser context. IndexedDB
    // persists across the sign-out per PR 8-B design (we scope reads
    // instead of wiping local data, so any unsynced offline writes
    // survive a quick A → B → A cycle).
    await signUpFresh(page, "B");

    // ── B navigates to the same per-game history page A just used.
    // Pre-fix: A's match leaked through. Post-fix: the viewer-scope
    // predicate in `useMatchList` filters it out.
    await page.goto("/games/7-wonders-duel");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.locator(
        "[data-testid='match-history'] >> [data-testid^='match-history-row-']",
      ),
    ).toHaveCount(0);

    // The empty-state copy ships from i18n. Match either language's
    // "no matches" line so the spec doesn't depend on the current
    // locale toggle.
    await expect(
      page.locator("[data-testid='match-history']"),
    ).toContainText(/No matches yet|Aucune partie pour le moment/i);

    // ── Rematch-URL leak: visiting `/games/7-wonders-duel/new?rematchOf=<A's id>`
    // as B used to prefill the form with A's player roster because the
    // rematch source read Dexie directly without a viewer gate. The fix
    // in `$slug_.new.tsx` uses `loadMatchVisibility` so non-visible matches
    // resolve to `null` and the form opens empty for B.
    await page.goto(`/games/7-wonders-duel/new?rematchOf=${aMatchId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.locator("[data-testid='new-match-player-0']"),
    ).toHaveValue("");
    await expect(
      page.locator("[data-testid='new-match-player-1']"),
    ).toHaveValue("");
  });
});
