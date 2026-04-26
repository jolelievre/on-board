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

async function resolvePlayerId(page: Page, name: string): Promise<string> {
  return page
    .locator(`[data-testid^='score-grid-player-'] >> text=${name}`)
    .first()
    .evaluate((el) =>
      el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
    );
}

test.describe("7 Wonders Duel — full flow", () => {
  test("create match, score, complete by score, see in history", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    const p1Id = await resolvePlayerId(page, names.p1);
    const p2Id = await resolvePlayerId(page, names.p2);

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

    // Complete button announces the winner before commit
    await expect(page.locator("[data-testid='complete-match']")).toContainText(
      names.p1,
    );

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

  test("special victory: military supremacy via checkbox + Complete", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    const p2Id = await resolvePlayerId(page, names.p2);

    // Tick the military supremacy checkbox for Bob
    await page.check(`[data-testid='supremacy-military_supremacy-${p2Id}']`);

    // Complete button label changes
    await expect(page.locator("[data-testid='complete-match']")).toHaveAttribute(
      "data-outcome",
      "military_supremacy",
    );
    await expect(page.locator("[data-testid='complete-match']")).toContainText(
      names.p2,
    );

    // Match is NOT complete until we click the button
    await expect(page.locator("[data-testid='winner-banner']")).toHaveCount(0);

    await page.click("[data-testid='complete-match']");

    await expect(page.locator("[data-testid='winner-banner']")).toContainText(
      names.p2,
    );
    await expect(page.locator("[data-testid='winner-banner']")).toContainText(
      /Military supremacy|Suprématie militaire/,
    );
  });

  test("supremacy checkboxes are mutually exclusive across both rows", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    const p1Id = await resolvePlayerId(page, names.p1);
    const p2Id = await resolvePlayerId(page, names.p2);

    // Tick military for Alice
    await page.check(`[data-testid='supremacy-military_supremacy-${p1Id}']`);
    await expect(
      page.locator(`[data-testid='supremacy-military_supremacy-${p1Id}']`),
    ).toBeChecked();

    // Tick scientific for Bob → military for Alice unchecks
    await page.check(`[data-testid='supremacy-scientific_supremacy-${p2Id}']`);
    await expect(
      page.locator(`[data-testid='supremacy-military_supremacy-${p1Id}']`),
    ).not.toBeChecked();
    await expect(
      page.locator(`[data-testid='supremacy-scientific_supremacy-${p2Id}']`),
    ).toBeChecked();
  });

  test("treasury input: 7 coins yields 2 VP toward the total", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    const p1Id = await resolvePlayerId(page, names.p1);

    await setScore(page, p1Id, "treasury", 7);

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

  test("civil tiebreaker: equal totals, more civil VP wins", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    const p1Id = await resolvePlayerId(page, names.p1);
    const p2Id = await resolvePlayerId(page, names.p2);

    // Both reach 7 VP, but Alice has more Civil VP.
    // Alice: civil=5, wonders=2 → 7
    // Bob:   civil=3, wonders=4 → 7
    // Tied at 7. Civil tiebreaker: Alice (5) > Bob (3) → Alice wins.
    await setScore(page, p1Id, "civil", 5);
    await setScore(page, p1Id, "wonders", 2);
    await setScore(page, p2Id, "civil", 3);
    await setScore(page, p2Id, "wonders", 4);

    await expect(
      page.locator(`[data-testid='score-grid-total-${p1Id}']`),
    ).toHaveText("7");
    await expect(
      page.locator(`[data-testid='score-grid-total-${p2Id}']`),
    ).toHaveText("7");

    await expect(page.locator("[data-testid='complete-match']")).toHaveAttribute(
      "data-outcome",
      "winner",
    );
    await expect(page.locator("[data-testid='complete-match']")).toContainText(
      /Civil tiebreaker|départage par les Civils/,
    );
    await expect(page.locator("[data-testid='complete-match']")).toContainText(
      names.p1,
    );

    await expect(page.locator("[data-testid='save-status']")).toHaveAttribute(
      "data-status",
      "saved",
      { timeout: 5000 },
    );
    await page.click("[data-testid='complete-match']");
    await expect(page.locator("[data-testid='winner-banner']")).toContainText(
      names.p1,
    );
  });

  test("draw: equal totals and equal civil VP yields a draw", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    const p1Id = await resolvePlayerId(page, names.p1);
    const p2Id = await resolvePlayerId(page, names.p2);

    await setScore(page, p1Id, "civil", 5);
    await setScore(page, p2Id, "civil", 5);

    await expect(page.locator("[data-testid='complete-match']")).toHaveAttribute(
      "data-outcome",
      "draw",
    );
    await expect(page.locator("[data-testid='complete-match']")).toContainText(
      /Declare draw|Déclarer une égalité/,
    );

    await expect(page.locator("[data-testid='save-status']")).toHaveAttribute(
      "data-status",
      "saved",
      { timeout: 5000 },
    );
    await page.click("[data-testid='complete-match']");
    await expect(page.locator("[data-testid='winner-banner']")).toContainText(
      /Draw|Égalité/,
    );
  });

  test("scientific_progress category contributes to total", async ({
    page,
  }) => {
    const names = uniqueNames();
    await startMatch(page, names);

    const p1Id = await resolvePlayerId(page, names.p1);

    // Progress tokens give VP directly (no conversion).
    await setScore(page, p1Id, "scientific_progress", 6);

    await expect(
      page.locator(`[data-testid='score-grid-total-${p1Id}']`),
    ).toHaveText("6");
  });
});
