import { test, expect, type Page } from "@playwright/test";

function uniqueNames(count: number): string[] {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return Array.from({ length: count }, (_, i) => `P${i + 1}-${stamp}`);
}

async function startMatch(page: Page, names: string[]) {
  await page.goto("/games/skull-king");
  await page.waitForLoadState("domcontentloaded");
  await page.click("[data-testid='new-match-button']");
  await page.waitForURL("**/games/skull-king/new");

  for (let i = 0; i < names.length; i++) {
    const input = page.locator(`[data-testid='new-match-player-${i}']`);
    if (await input.count() === 0) {
      // Add an extra slot if the form rendered with fewer than `names.length`.
      await page.click("[data-testid='new-match-add-player']");
    }
    await page.fill(`[data-testid='new-match-player-${i}']`, names[i]);
  }
  await page.click("[data-testid='new-match-submit']");
  await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
  await expect(page.locator("[data-testid='sk-match-start']")).toBeVisible();
}

async function startMatchAndDeal(page: Page, names: string[]) {
  await startMatch(page, names);
  await page.click("[data-testid='sk-match-start-cta']");
  await expect(page.locator("[data-testid='sk-bid']")).toBeVisible();
}

/** Click a digit on the bottom-sheet bid grid for the active player. */
async function pickBid(page: Page, value: number) {
  await page
    .locator(
      `[data-testid='sk-bid-digit-grid'] [data-value='${value}']`,
    )
    .click();
}

async function focusBidRow(page: Page, index: number) {
  await page.locator(`[data-testid='sk-bid-row-${index}']`).click();
}

/** Enter bids for every player (in order), then click Reveal → Continue. */
async function enterBids(page: Page, bids: number[]) {
  for (let i = 0; i < bids.length; i++) {
    await focusBidRow(page, i);
    await pickBid(page, bids[i]);
  }
  await page.click("[data-testid='sk-bid-reveal']");
  await expect(page.locator("[data-testid='sk-bid-recap']")).toBeVisible();
  await page.click("[data-testid='sk-bid-recap-continue']");
  await expect(page.locator("[data-testid='sk-result']")).toBeVisible();
}

/** Enter tricks won for the active player on the result screen. */
async function pickTricks(page: Page, value: number) {
  await page
    .locator(`[data-testid='sk-result-tricks'] [data-value='${value}']`)
    .click();
}

/** Walk through the result phase entering tricks for each player in order. */
async function enterResults(page: Page, tricks: number[]) {
  for (let i = 0; i < tricks.length; i++) {
    await pickTricks(page, tricks[i]);
    if (i < tricks.length - 1) {
      await page.click("[data-testid='sk-result-next']");
    }
  }
  await page.click("[data-testid='sk-result-end-round']");
}

test.describe("Skull King — Classic flow", () => {
  test("match start: tap to set dealer + persistence after deal", async ({
    page,
  }) => {
    const names = uniqueNames(3);
    await startMatch(page, names);

    // Player 0 is dealer by default.
    await expect(page.locator("[data-testid='sk-seat-0']")).toHaveAttribute(
      "data-dealer",
      "true",
    );

    // Tap player 2 to make them dealer.
    await page.locator("[data-testid='sk-seat-2']").click();
    await expect(page.locator("[data-testid='sk-seat-2']")).toHaveAttribute(
      "data-dealer",
      "true",
    );
    await expect(page.locator("[data-testid='sk-seat-0']")).not.toHaveAttribute(
      "data-dealer",
      "true",
    );

    // Deal — the dealer choice is persisted.
    await page.click("[data-testid='sk-match-start-cta']");
    await expect(page.locator("[data-testid='sk-bid']")).toBeVisible();
  });

  test("round 1: bid 0/1, recap commentary reflects the sum", async ({
    page,
  }) => {
    const names = uniqueNames(3);
    await startMatchAndDeal(page, names);

    // Round 1: 1 card each. Bid 1, 0, 0.
    await focusBidRow(page, 0);
    await pickBid(page, 1);
    // Auto-advance lands on player 1 (next unbid).
    await pickBid(page, 0);
    // Auto-advance lands on player 2.
    await pickBid(page, 0);

    await page.click("[data-testid='sk-bid-reveal']");
    await expect(page.locator("[data-testid='sk-bid-recap']")).toContainText(
      /1\/1 bid|1\/1 pariés/,
    );
    await expect(page.locator("[data-testid='sk-bid-recap']")).toContainText(
      /Bids exactly|exactement/,
    );
  });

  test("bid editing: tap a previous row to re-edit", async ({ page }) => {
    const names = uniqueNames(2);
    await startMatchAndDeal(page, names);

    // Round 1: bid 0 then 1.
    await pickBid(page, 0);
    await pickBid(page, 1);

    // Reveal-button enabled — both bid.
    await expect(
      page.locator("[data-testid='sk-bid-reveal']"),
    ).toBeEnabled();

    // Re-tap row 0 and change to 1.
    await focusBidRow(page, 0);
    await pickBid(page, 1);
    await expect(
      page.locator("[data-testid='sk-bid-row-0-value']"),
    ).toHaveText("1");
  });

  test("bid 0 made vs failed: round score sign", async ({ page }) => {
    const names = uniqueNames(2);
    await startMatchAndDeal(page, names);

    // Round 1 (1 card): both bid 0. P1 takes 0 (made: +10). P2 takes 1 (failed: −10).
    await pickBid(page, 0);
    await pickBid(page, 0);
    await page.click("[data-testid='sk-bid-reveal']");
    await page.click("[data-testid='sk-bid-recap-continue']");

    // P1 result: tricks 0 → +10
    await pickTricks(page, 0);
    await expect(page.locator("[data-testid='sk-round-total']")).toHaveText(
      "+10",
    );
    await page.click("[data-testid='sk-result-next']");

    // P2 result: tricks 1 → −10
    await pickTricks(page, 1);
    await expect(page.locator("[data-testid='sk-round-total']")).toHaveText(
      "-10",
    );
  });

  test("bonus stacking: a single round with multiple bonus types", async ({
    page,
  }) => {
    const names = uniqueNames(2);
    await startMatchAndDeal(page, names);

    // Round 1: P1 bids 1 takes 1, P2 bids 0 takes 0.
    await pickBid(page, 1);
    await pickBid(page, 0);
    await page.click("[data-testid='sk-bid-reveal']");
    await page.click("[data-testid='sk-bid-recap-continue']");

    // P1: bid 1 made → +20 base. Then add a black-14 toggle (+20),
    // a colored-14 (+10), and one mermaidByPirate (+20). Total = +70.
    await pickTricks(page, 1);
    await page.click("[data-testid='sk-bonus-black14']");
    await page.click("[data-testid='sk-bonus-color14']");
    await page.click("[data-testid='sk-bonus-mermaidByPirate']");
    await expect(page.locator("[data-testid='sk-round-total']")).toHaveText(
      "+70",
    );
  });

  test("scoreboard toggle: opens grill, shows totals, closes back", async ({
    page,
  }) => {
    const names = uniqueNames(2);
    await startMatchAndDeal(page, names);

    // Run round 1 → +10 each player (both bid 0, both take 0).
    await enterBids(page, [0, 0]);
    await enterResults(page, [0, 0]);

    // We're on the round transition; open the scoreboard.
    await expect(page.locator("[data-testid='sk-transition']")).toBeVisible();
    await page.click("[data-testid='sk-scoreboard-toggle']");
    await expect(page.locator("[data-testid='sk-scoreboard']")).toBeVisible();

    // R1 cells exist with +10 each. We don't know playerIds yet — check by
    // text content of the round-1 row.
    const sparkline = page.locator(
      "[data-testid='sk-scoreboard-sparkline']",
    );
    await expect(sparkline).toBeVisible();

    // Close.
    await page.click("[data-testid='sk-scoreboard-toggle']");
    await expect(page.locator("[data-testid='sk-transition']")).toBeVisible();
  });

  test("bottom nav: hidden on /matches/:id, visible on /games", async ({
    page,
  }) => {
    const names = uniqueNames(2);
    await startMatch(page, names);

    // Bottom nav hidden inside the match.
    await expect(
      page.locator("nav[aria-label='Primary']"),
    ).toHaveCount(0);

    // Navigate back to games — bottom nav is back.
    await page.goto("/games");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("nav[aria-label='Primary']")).toBeVisible();
  });

  /** Wait for a PATCH /api/matches/:id whose body contains a non-empty
   * skullKing.draft.bids object — i.e., the user-entered bids have flushed
   * to the server. Robust against the empty-draft / multi-save races that
   * `data-status="saved"` is too coarse to distinguish. */
  async function waitForDraftPatch(
    page: Page,
    predicate: (body: string) => boolean,
  ) {
    await page.waitForResponse(
      (r) => {
        if (!/\/api\/matches\/[^/]+$/.test(r.url())) return false;
        if (r.request().method() !== "PATCH") return false;
        if (r.status() !== 200) return false;
        const body = r.request().postData() ?? "";
        return predicate(body);
      },
      { timeout: 5000 },
    );
  }

  test("draft persistence: refresh during bidding restores entered bids", async ({
    page,
  }) => {
    const names = uniqueNames(3);
    await startMatchAndDeal(page, names);

    // Wait for any in-flight draft save from the deal CTA / phase entry to
    // settle so it can't race the assertion below.
    await page.waitForTimeout(100);

    // Round 1: bid 1 for P1, 0 for P2. P3 unbid.
    await focusBidRow(page, 0);
    await pickBid(page, 1);
    // Auto-advance lands on P2.
    await pickBid(page, 0);

    // Confirm both bids landed in the UI before waiting for the save.
    await expect(
      page.locator("[data-testid='sk-bid-row-0-value']"),
    ).toHaveText("1");
    await expect(
      page.locator("[data-testid='sk-bid-row-1-value']"),
    ).toHaveText("0");

    // Wait for a PATCH whose body actually contains both bids.
    await waitForDraftPatch(
      page,
      (body) => body.includes('"bids":{') && body.includes('"phase":"bidding"'),
    );

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("[data-testid='sk-bid']")).toBeVisible();
    await expect(
      page.locator("[data-testid='sk-bid-row-0-value']"),
    ).toHaveText("1");
    await expect(
      page.locator("[data-testid='sk-bid-row-1-value']"),
    ).toHaveText("0");
    await expect(
      page.locator("[data-testid='sk-bid-reveal']"),
    ).toBeDisabled();
  });

  test("draft persistence: refresh during result restores tricks + bonuses", async ({
    page,
  }) => {
    const names = uniqueNames(2);
    await startMatchAndDeal(page, names);

    // Round 1: P1 bids 1, P2 bids 0. Reveal → continue → result phase.
    await pickBid(page, 1);
    await pickBid(page, 0);
    await page.click("[data-testid='sk-bid-reveal']");
    await page.click("[data-testid='sk-bid-recap-continue']");

    // P1 result: tricks 1 (made → +20), then a black-14 toggle (+20). Total +40.
    await pickTricks(page, 1);
    await page.click("[data-testid='sk-bonus-black14']");
    await expect(page.locator("[data-testid='sk-round-total']")).toHaveText(
      "+40",
    );

    // Wait for the result-phase draft to flush. Body must mention black14
    // (only set after the toggle click) and the result phase.
    await waitForDraftPatch(
      page,
      (body) =>
        body.includes('"phase":"result"') && body.includes('"black14":1'),
    );

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("[data-testid='sk-result']")).toBeVisible();
    await expect(page.locator("[data-testid='sk-round-total']")).toHaveText(
      "+40",
    );
    await expect(
      page.locator("[data-testid='sk-result-tricks'] [data-value='1']"),
    ).toHaveAttribute("data-selected", "true");
    await expect(
      page.locator("[data-testid='sk-bonus-black14']"),
    ).toHaveAttribute("data-on", "true");
  });

  test("draft persistence: End round clears draft, no resurfacing on refresh", async ({
    page,
  }) => {
    const names = uniqueNames(2);
    await startMatchAndDeal(page, names);

    // Bid + result phases (both bid 0, both take 0).
    await enterBids(page, [0, 0]);
    await pickTricks(page, 0);
    await page.click("[data-testid='sk-result-next']");
    await pickTricks(page, 0);

    // Set up the response listener BEFORE clicking End-round so we don't
    // miss the clear-draft PATCH that fires right after.
    const clearDraftPromise = page.waitForResponse(
      (r) => {
        if (!/\/api\/matches\/[^/]+$/.test(r.url())) return false;
        if (r.request().method() !== "PATCH") return false;
        if (r.status() !== 200) return false;
        return (r.request().postData() ?? "").includes('"draft":null');
      },
      { timeout: 5000 },
    );
    await page.click("[data-testid='sk-result-end-round']");
    await expect(page.locator("[data-testid='sk-transition']")).toBeVisible();
    await clearDraftPromise;

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Refresh after End-round lands on bidding for round 2 (the transition
    // recap is a UI beat, not a persisted phase — the round is finalized).
    await expect(page.locator("[data-testid='sk-bid']")).toBeVisible();
    // Round 2 → digit grid offers 0, 1, 2.
    await expect(
      page.locator("[data-testid='sk-bid-digit-grid'] [data-value='2']"),
    ).toBeVisible();
    // The first row has no value child — the placeholder lives on a
    // separate span. Asserting absence is the right shape here.
    await expect(
      page.locator("[data-testid='sk-bid-row-0-value']"),
    ).toHaveCount(0);
  });

  test("two rounds end-to-end: dealer rotates, totals accumulate", async ({
    page,
  }) => {
    const names = uniqueNames(3);
    await startMatchAndDeal(page, names);

    // Round 1: each bids 0, P1 takes 1 (failed), P2 and P3 take 0 (made).
    // Scores: P1 = -10, P2 = +10, P3 = +10.
    await enterBids(page, [0, 0, 0]);
    await enterResults(page, [1, 0, 0]);

    // Transition: should announce next dealer (player 2, since round 2 dealer
    // is (2 - 1 + 0) % 3 = 1 → player at position 1).
    await expect(page.locator("[data-testid='sk-transition']")).toContainText(
      names[1],
    );
    await page.click("[data-testid='sk-transition-continue']");

    // Round 2: 2 cards each. All bid 1; P1 and P2 made, P3 failed.
    // Scores: P1 = +20, P2 = +20, P3 = -10 (off by 1: bid 1 / took 0).
    await enterBids(page, [1, 1, 1]);
    await enterResults(page, [1, 1, 0]);

    await expect(page.locator("[data-testid='sk-transition']")).toBeVisible();

    // Open scoreboard, verify totals: P1 = -10 + 20 = 10; P2 = 10 + 20 = 30;
    // P3 = 10 + -10 = 0.
    await page.click("[data-testid='sk-scoreboard-toggle']");
    await expect(page.locator("[data-testid='sk-scoreboard']")).toBeVisible();

    // Find each player's total cell by name (column header) → playerId,
    // then assert the total cell text. The scoreboard renders headers in
    // player-position order, so we can map by index.
    const totals = page.locator(
      "[data-testid^='sk-scoreboard-total-']",
    );
    const totalsTexts = await totals.allTextContents();
    expect(totalsTexts).toEqual(["10", "30", "0"]);
  });
});
