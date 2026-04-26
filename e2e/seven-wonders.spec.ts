import { test, expect, type Page } from "@playwright/test";

function uniqueNames() {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return { p1: `Alice-${stamp}`, p2: `Bob-${stamp}` };
}

async function startMatch(page: Page, names: { p1: string; p2: string }) {
  await page.goto("/games/7-wonders-duel");
  await page.waitForLoadState("domcontentloaded");
  await page.click("[data-testid='new-match-button']");
  await page.waitForURL("**/games/7-wonders-duel/new");
  await page.fill("[data-testid='new-match-player-0']", names.p1);
  await page.fill("[data-testid='new-match-player-1']", names.p2);
  await page.click("[data-testid='new-match-submit']");
  await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
}

async function setScore(
  page: Page,
  playerSelector: string,
  category: string,
  value: number,
) {
  const input = page.locator(
    `[data-testid='score-input-${playerSelector}-${category}']`,
  );
  await input.fill(String(value));
  await input.blur();
}

test.describe("7 Wonders Duel — full flow", () => {
  test("create match, score, complete by score, see in history", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    // Resolve player IDs from the testid attributes on the grid header
    const p1Id = await page
      .locator(`[data-testid^='score-grid-player-'] >> text=${names.p1}`)
      .first()
      .evaluate((el) =>
        el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
      );
    const p2Id = await page
      .locator(`[data-testid^='score-grid-player-'] >> text=${names.p2}`)
      .first()
      .evaluate((el) =>
        el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
      );

    // Alice: civil 8, scientific 6 → total 14
    // Bob: wonders 4 → total 4
    await setScore(page, p1Id, "civil", 8);
    await setScore(page, p1Id, "scientific", 6);
    await setScore(page, p2Id, "wonders", 4);

    await expect(
      page.locator(`[data-testid='score-grid-total-${p1Id}']`),
    ).toHaveText("14");
    await expect(
      page.locator(`[data-testid='score-grid-total-${p2Id}']`),
    ).toHaveText("4");

    // Wait for debounced save to land
    await expect(page.locator("[data-testid='save-status']")).toHaveAttribute(
      "data-status",
      "saved",
      { timeout: 5000 },
    );

    // Complete the match — Alice wins
    await page.click("[data-testid='complete-match']");

    await expect(page.locator("[data-testid='winner-banner']")).toContainText(
      names.p1,
    );

    // Grid is disabled
    await expect(
      page.locator(`[data-testid='score-input-${p1Id}-civil']`),
    ).toBeDisabled();

    // Back to game → history shows the match with Alice as winner
    await page.click("[data-testid='back-to-game']");
    await page.waitForURL("**/games/7-wonders-duel");
    const history = page.locator("[data-testid='match-history']");
    await expect(history).toContainText(names.p1);
    await expect(history).toContainText(names.p2);
    await expect(history).toContainText("(14)");
    await expect(history).toContainText("(4)");
  });

  test("special victory: military supremacy ends the match immediately", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    const p2Id = await page
      .locator(`[data-testid^='score-grid-player-'] >> text=${names.p2}`)
      .first()
      .evaluate((el) =>
        el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
      );

    // Declare military supremacy for player 2 — no scores entered
    await page.click(`[data-testid='declare-military-${p2Id}']`);

    await expect(page.locator("[data-testid='winner-banner']")).toContainText(
      names.p2,
    );
    await expect(page.locator("[data-testid='winner-banner']")).toContainText(
      /Military supremacy|Suprématie militaire/,
    );
  });

  test("treasury input: 7 coins yields 2 VP toward the total", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    const p1Id = await page
      .locator(`[data-testid^='score-grid-player-'] >> text=${names.p1}`)
      .first()
      .evaluate((el) =>
        el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
      );

    await setScore(page, p1Id, "treasury", 7);

    // 7 coins → 2 VP
    await expect(
      page.locator(`[data-testid='score-treasury-hint-${p1Id}']`),
    ).toContainText(/7/);
    await expect(
      page.locator(`[data-testid='score-treasury-hint-${p1Id}']`),
    ).toContainText(/2/);
    await expect(
      page.locator(`[data-testid='score-grid-total-${p1Id}']`),
    ).toHaveText("2");
  });
});
