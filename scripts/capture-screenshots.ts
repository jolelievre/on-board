/**
 * Captures mobile-viewport (Pixel 5) screenshots of every current screen into
 * `plan-assets/screenshots/` to ship with a design brief.
 *
 * Both themes are captured in a single run: each authenticated screen produces
 * a parchment (light, no suffix) and a candlelit (dark, `-dark` suffix) PNG.
 *
 * Standalone — not part of the E2E test campaign. Run via:
 *   npm run screenshots
 *
 * Flow:
 *   1. Boots a fresh Vite dev server in test mode (VITE_TEST_AUTH=true).
 *   2. Stubs `navigator.mediaDevices.getUserMedia` with a canvas-driven
 *      stream so the avatar uploader's camera view and the link scanner's
 *      QR viewport render without real camera hardware.
 *   3. Captures the signed-out login screens in parchment.
 *   4. Signs up a throwaway user, then seeds friend profiles + completed
 *      matches across both games via the API so that:
 *        - Players tab shows multiple rows
 *        - Profile detail shows stats + recent matches
 *        - "Played with" chips appear on the new-match form
 *        - Game detail shows match history
 *   5. Walks the app twice (parchment then candlelit), capturing every
 *      screen per theme. Theme + language are flipped via the real
 *      Settings pills so changes persist server-side.
 *   6. Captures the signed-out login screens in candlelit.
 *   7. Tears the dev server down.
 *
 * Numbering groups screens by area so the design session has a natural
 * reading order: 01 login → 02 games → 03 game detail → 04-05 new-match
 * → 06-08 7WD scoring → 09 7WD history → 10-11 Skull King → 12 SK history
 * → 13-14 Players → 15 profile detail → 16-17 avatar editor
 * → 18-19 link surfaces → 20 merge dialog → 21-23 settings.
 */

import { chromium, devices, type Page } from "playwright";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs/promises";
import net from "net";

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.resolve(import.meta.dirname, "..", "plan-assets", "screenshots");
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

type Theme = "parchment" | "candlelit";
const PASSES: ReadonlyArray<{ theme: Theme; suffix: string }> = [
  { theme: "parchment", suffix: "" },
  { theme: "candlelit", suffix: "-dark" },
];

const FRIEND_ALIASES = ["Alice", "Bob", "Charlie", "Diana"] as const;

type SeededFriend = { id: string; alias: string };
type SeededGame = { id: string; slug: string };

async function waitForPort(port: number, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.connect(port, "localhost", () => {
        sock.end();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Dev server did not come up on port ${port} within ${timeoutMs}ms`);
}

async function killPort(port: number) {
  await new Promise<void>((resolve) => {
    const k = spawn("sh", ["-c", `lsof -ti :${port} | xargs kill -9 2>/dev/null; true`]);
    k.on("close", () => resolve());
  });
}

function startDevServer(): ChildProcess {
  const proc = spawn("npx", ["vite"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      VITE_TEST_AUTH: "true",
    },
    stdio: "inherit",
    detached: true,
  });
  return proc;
}

async function shoot(page: Page, name: string) {
  await page.addStyleTag({
    content: `
      .TanStackRouterDevtools, [data-testid="router-devtools-toggle"],
      .tsqd-parent-container, .tsr-devtools, .tsr-devtools-trigger {
        display: none !important;
      }
      body > div[style*="position: fixed"][style*="z-index"] { display: none !important; }
    `,
  });
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    fullPage: true,
  });
}

// Click a PillSwitch radio button by its visible label.
async function clickPillOption(page: Page, label: string) {
  const button = page
    .locator("button[role='radio']", { hasText: new RegExp(`^${label}$`) })
    .first();
  if ((await button.getAttribute("aria-checked")) === "true") return;
  await button.click();
}

async function ensureLanguage(page: Page, lang: "en" | "fr") {
  await clickPillOption(page, lang === "en" ? "English" : "Français");
  await page.waitForTimeout(200);
}

async function ensureTheme(page: Page, theme: Theme) {
  const current = await page.evaluate(() => document.documentElement.dataset.theme);
  if (current === theme) return;
  await clickPillOption(page, theme === "parchment" ? "Parchment" : "Candlelit");
  await page.waitForFunction(
    (t) => document.documentElement.dataset.theme === t,
    theme,
  );
}

async function signUp(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("input[name='email']");
  await page.fill("input[name='name']", "Test User");
  await page.fill("input[name='email']", `screenshots-${stamp}@example.com`);
  await page.fill("input[name='password']", "testpassword123");
  await page.click("button[type='submit']");
  await page.waitForURL(`${BASE_URL}/games`, { timeout: 10_000 });
}

/**
 * Seed friend profiles + completed past matches via the API. Runs in
 * the signed-in browser context so cookies stick. After this returns
 * we reload the SPA so Dexie pulls everything we just wrote.
 */
async function seedData(
  page: Page,
): Promise<{ friends: SeededFriend[]; games: Record<string, SeededGame> }> {
  const req = page.context().request;
  const friends: SeededFriend[] = [];
  for (const alias of FRIEND_ALIASES) {
    const res = await req.post("/api/profiles", { data: { alias } });
    if (!res.ok()) throw new Error(`seed createProfile(${alias}) ${res.status()}`);
    const body = (await res.json()) as { id: string };
    friends.push({ id: body.id, alias });
  }

  const games: Record<string, SeededGame> = {};
  for (const slug of ["7-wonders-duel", "skull-king"]) {
    const res = await req.get(`/api/games/${slug}`);
    const game = (await res.json()) as { id: string; slug: string };
    games[slug] = { id: game.id, slug: game.slug };
  }

  // Two completed 7WD matches → game detail history populated +
  // played-with chips on the new-match form. Different player pairings
  // so the chip row shows multiple groupings.
  await playCompletedMatch(page, games["7-wonders-duel"].id, [friends[0], friends[1]], "7wd");
  await playCompletedMatch(page, games["7-wonders-duel"].id, [friends[0], friends[2]], "7wd");

  // One completed Skull King match → SK game detail history populated.
  await playCompletedMatch(
    page,
    games["skull-king"].id,
    [friends[0], friends[1], friends[2]],
    "sk",
  );

  await page.goto(`${BASE_URL}/games`);
  await page.waitForLoadState("domcontentloaded");

  return { friends, games };
}

/**
 * Create + complete a past match via API. Hardcoded scores per game
 * type — the scorer's exact category names don't matter for the
 * design brief; what matters is that the match shows up as completed
 * in history with a winner.
 */
async function playCompletedMatch(
  page: Page,
  gameId: string,
  players: SeededFriend[],
  kind: "7wd" | "sk",
) {
  const req = page.context().request;
  const matchRes = await req.post("/api/matches", {
    data: {
      gameId,
      players: players.map((p, i) => ({ profileId: p.id, position: i })),
    },
  });
  if (!matchRes.ok()) {
    throw new Error(`seed createMatch ${matchRes.status()} ${await matchRes.text()}`);
  }
  const match = (await matchRes.json()) as {
    id: string;
    players: { id: string; profileId: string }[];
  };

  const scoreRows: { playerId: string; category: string; value: number }[] = [];
  if (kind === "7wd") {
    // Two seats. Seat 0 wins.
    const cats = [
      { c: "civil", a: 12, b: 4 },
      { c: "scientific", a: 6, b: 9 },
      { c: "wonders", a: 5, b: 3 },
      { c: "treasury", a: 4, b: 2 },
      { c: "commercial", a: 3, b: 1 },
    ];
    for (const { c, a, b } of cats) {
      scoreRows.push({ playerId: match.players[0].id, category: c, value: a });
      scoreRows.push({ playerId: match.players[1].id, category: c, value: b });
    }
  } else {
    // Skull King: 10 round totals per player. Single "round-N" category
    // per row matches what the scorer persists; design only needs the
    // match-complete winner banner + history row.
    const totals = [
      [20, 30, -10, 40, 60, 30, 40, 70, 50, 80], // winner
      [10, 20, 30, 20, 30, 40, 20, 30, 50, 30],
      [10, -10, 20, 30, -20, 30, 30, 40, 20, 60],
    ];
    for (let pi = 0; pi < players.length; pi++) {
      for (let r = 0; r < 10; r++) {
        scoreRows.push({
          playerId: match.players[pi].id,
          category: `round-${r + 1}`,
          value: totals[pi][r],
        });
      }
    }
  }

  const scoreRes = await req.patch(`/api/matches/${match.id}/scores`, {
    data: { scores: scoreRows },
  });
  if (!scoreRes.ok()) {
    throw new Error(`seed PATCH scores ${scoreRes.status()} ${await scoreRes.text()}`);
  }

  const putRes = await req.put(`/api/matches/${match.id}`, {
    data: {
      status: "COMPLETED",
      // 2-5 days ago so the timestamps look real and distinct.
      completedAt: new Date(
        Date.now() - (2 + Math.floor(Math.random() * 4)) * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
  });
  if (!putRes.ok()) {
    throw new Error(`seed PUT match ${putRes.status()} ${await putRes.text()}`);
  }
}

async function captureLoginScreens(page: Page, suffix: string) {
  await page.context().clearCookies();
  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("h1");

  await shoot(page, `01-login-dev${suffix}`);

  await page.evaluate(() => {
    const form = document.querySelector("form");
    if (!form) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "rounded-lg bg-white px-4 py-3 font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50";
    btn.textContent = "Sign in with Google";
    form.replaceWith(btn);
  });
  await shoot(page, `01-login-prod${suffix}`);
}

async function captureGamesAndNewMatch(
  page: Page,
  suffix: string,
  friends: SeededFriend[],
) {
  await page.goto(`${BASE_URL}/games`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("h1");
  await shoot(page, `02-games-list${suffix}`);

  await page.goto(`${BASE_URL}/games/7-wonders-duel`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='new-match-button']");
  await shoot(page, `03-game-detail-7wd${suffix}`);

  await page.goto(`${BASE_URL}/games/7-wonders-duel/new`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='new-match-player-0']");
  // Empty form; played-with chips show because seed populated them.
  await shoot(page, `04-new-match-form${suffix}`);

  // Focus an input and type a letter so the picker opens and shows
  // suggestion chips from the seeded profiles. Use the first letter of
  // the second friend so we get a clear single-match suggestion.
  const probe = friends[1].alias.slice(0, 1);
  await page.fill("[data-testid='new-match-player-0']", probe);
  await page.focus("[data-testid='new-match-player-0']");
  await page.waitForSelector("[data-testid='new-match-suggestions-0']");
  await page.waitForTimeout(200);
  await shoot(page, `05-new-match-picker${suffix}`);
  // Reset before moving on.
  await page.fill("[data-testid='new-match-player-0']", "");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

async function captureSevenWondersFlow(page: Page, suffix: string) {
  const p1 = "Alice";
  const p2 = "Bob";

  await page.goto(`${BASE_URL}/games/7-wonders-duel/new`);
  await page.waitForLoadState("domcontentloaded");
  // Use raw filling — when the input matches a seeded profile alias
  // exactly, the submit handler resolves it to the existing Profile
  // (no duplicate). Blur before submit so the picker collapses.
  await page.fill("[data-testid='new-match-player-0']", p1);
  await page.locator("[data-testid='new-match-player-0']").blur();
  await page.fill("[data-testid='new-match-player-1']", p2);
  await page.locator("[data-testid='new-match-player-1']").blur();
  await page.click("[data-testid='new-match-submit']");
  await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
  await page.waitForSelector("[data-testid^='score-grid-player-']");

  await shoot(page, `06-7wd-scoring-empty${suffix}`);

  const playerId = (name: string) =>
    page
      .locator(`[data-testid^='score-grid-player-'] >> text=${name}`)
      .first()
      .evaluate((el) =>
        el.getAttribute("data-testid")!.replace("score-grid-player-", ""),
      );

  const p1Id = await playerId(p1);
  const p2Id = await playerId(p2);

  const fill = async (pid: string, cat: string, value: number) => {
    const input = page.locator(`[data-testid='score-input-${pid}-${cat}']`);
    await input.fill(String(value));
    await input.blur();
  };

  await fill(p1Id, "civil", 8);
  await fill(p1Id, "scientific", 6);
  await fill(p1Id, "wonders", 5);
  await fill(p1Id, "treasury", 7);
  await fill(p1Id, "commercial", 3);
  await fill(p2Id, "civil", 4);
  await fill(p2Id, "scientific", 9);
  await fill(p2Id, "wonders", 3);
  await fill(p2Id, "guilds", 4);
  await fill(p2Id, "military", 2);

  // Wait for the queue to drain. SyncStatus renders nothing while idle,
  // shows "saving" mid-flight, briefly "saved", then unmounts again —
  // any of "missing" / "saved" / "idle" means the score writes landed.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector("[data-testid='sync-status']");
        if (!el) return true;
        return el.getAttribute("data-status") !== "saving";
      },
      { timeout: 5_000 },
    )
    .catch(() => {});

  await shoot(page, `07-7wd-scoring-filled${suffix}`);

  await page.click("[data-testid='complete-match']");
  await page.waitForSelector("[data-testid='winner-banner']");
  await shoot(page, `08-7wd-match-completed${suffix}`);

  await page.click("[data-testid='back-to-game']");
  await page.waitForURL(`${BASE_URL}/games/7-wonders-duel`);
  await page.waitForSelector("[data-testid='match-history']");
  await shoot(page, `09-7wd-history${suffix}`);
}

/**
 * Pick a digit in either the bidding picker or the round-result tricks
 * picker. Both render via `DigitGrid` (buttons keyed by `data-value`).
 * The bidding screen auto-advances to the next unbid seat once a row
 * commits, so successive calls land on successive players.
 */
async function pickDigit(page: Page, gridTestId: string, value: number) {
  await page.click(
    `[data-testid='${gridTestId}'] button[data-value='${value}']:not([data-disabled='true'])`,
  );
}

/**
 * Walk through the full Skull King flow:
 *   1. Create a 3-player match
 *   2. Round 1: bidding → recap → result → transition
 *   3. Scoreboard overlay
 *   4. Seed rounds 2–9 via API to jump to round 10
 *   5. Round 10: bidding → result → match complete
 *   6. Back to game detail to show history.
 * Each phase captures one screenshot.
 */
async function captureSkullKingFlow(page: Page, suffix: string) {
  await page.goto(`${BASE_URL}/games/skull-king/new`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='new-match-player-0']");

  const aliases = ["Alice", "Bob", "Charlie"];
  while (
    (await page.locator("[data-testid^='new-match-player-']").count()) <
    aliases.length
  ) {
    await page.click("[data-testid='new-match-add-player']");
  }
  for (let i = 0; i < aliases.length; i++) {
    await page.fill(`[data-testid='new-match-player-${i}']`, aliases[i]);
    await page.locator(`[data-testid='new-match-player-${i}']`).blur();
  }
  await page.click("[data-testid='new-match-submit']");
  await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
  const matchId = page.url().split("/").pop() as string;
  await page.waitForSelector("[data-testid='sk-match-start']");
  await shoot(page, `10-sk-match-start${suffix}`);

  // ── Round 1 ────────────────────────────────────────────────────────
  await page.click("[data-testid='sk-match-start-cta']");
  await page.waitForSelector("[data-testid='sk-bid']");
  await page.waitForTimeout(200);
  await shoot(page, `11-sk-r1-bidding${suffix}`);

  // Round 1 each player has 1 card → max bid = 1. All bid 1 — the
  // bidding screen auto-advances seat after every pick.
  await pickDigit(page, "sk-bid-digit-grid", 1);
  await pickDigit(page, "sk-bid-digit-grid", 1);
  await pickDigit(page, "sk-bid-digit-grid", 1);
  await page.click("[data-testid='sk-bid-reveal']");
  await page.waitForSelector("[data-testid='sk-bid-recap']");
  await page.waitForTimeout(150);
  await shoot(page, `12-sk-r1-recap${suffix}`);

  await page.click("[data-testid='sk-bid-recap-continue']");
  await page.waitForSelector("[data-testid='sk-result']");
  await page.waitForTimeout(150);
  await shoot(page, `13-sk-r1-result${suffix}`);

  // Tricks for round 1 must sum to 1. Alice 1, Bob 0, Charlie 0 → Alice
  // hits her bid, the other two miss.
  await pickDigit(page, "sk-result-tricks", 1);
  await page.click("[data-testid='sk-result-next']");
  await pickDigit(page, "sk-result-tricks", 0);
  await page.click("[data-testid='sk-result-next']");
  await pickDigit(page, "sk-result-tricks", 0);
  await page.click("[data-testid='sk-result-end-round']");
  await page.waitForSelector("[data-testid='sk-transition']");
  await page.waitForTimeout(200);
  await shoot(page, `14-sk-r1-transition${suffix}`);

  // ── Scoreboard overlay ─────────────────────────────────────────────
  await page.click("[data-testid='sk-scoreboard-toggle']");
  await page.waitForSelector("[data-testid='sk-scoreboard']");
  await page.waitForTimeout(200);
  await shoot(page, `15-sk-scoreboard${suffix}`);
  await page.click("[data-testid='sk-scoreboard-close']");
  await page.waitForSelector("[data-testid='sk-transition']");

  // ── Fast-forward to round 10 via API ───────────────────────────────
  // Get player order so we can seed scores by playerId.
  const matchSummary = (await (
    await page.context().request.get(`/api/matches/${matchId}`)
  ).json()) as { players: { id: string; profileId: string }[] };
  // Match the order we filled the form in (Alice, Bob, Charlie).
  const [aliceId, bobId, charlieId] = matchSummary.players.map((p) => p.id);
  await seedSkullKingRounds(page, matchId, {
    aliceId,
    bobId,
    charlieId,
  });

  // Reload the match page so the scorer reads the new rounds and lands
  // on round 10's bidding screen.
  await page.goto(`${BASE_URL}/matches/${matchId}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='sk-bid']");
  await page.waitForTimeout(300);
  await shoot(page, `16-sk-r10-bidding${suffix}`);

  // Round 10 max bid = 10. Spread the picks so the recap looks
  // distinct from round 1.
  await pickDigit(page, "sk-bid-digit-grid", 7);
  await pickDigit(page, "sk-bid-digit-grid", 4);
  await pickDigit(page, "sk-bid-digit-grid", 2);
  await page.click("[data-testid='sk-bid-reveal']");
  await page.waitForSelector("[data-testid='sk-bid-recap']");
  await page.click("[data-testid='sk-bid-recap-continue']");
  await page.waitForSelector("[data-testid='sk-result']");
  await page.waitForTimeout(200);
  // Fill tricks for Alice first so the result screen shows the
  // cumulative-total panel populated from the 9 seeded rounds — that's
  // the late-game state we want the design session to see.
  await pickDigit(page, "sk-result-tricks", 7);
  await shoot(page, `17-sk-r10-result${suffix}`);

  await page.click("[data-testid='sk-result-next']");
  await pickDigit(page, "sk-result-tricks", 3);
  await page.click("[data-testid='sk-result-next']");
  await pickDigit(page, "sk-result-tricks", 0);
  await page.click("[data-testid='sk-result-end-round']");
  await page.waitForSelector("[data-testid='sk-match-complete']");
  await page.waitForTimeout(300);
  await shoot(page, `18-sk-match-complete${suffix}`);

  // ── Back to game detail history ────────────────────────────────────
  await page.click("[data-testid='back-to-game']");
  await page.waitForURL(`${BASE_URL}/games/skull-king`);
  await page.waitForSelector("[data-testid='match-history']");
  await shoot(page, `19-sk-history${suffix}`);
}

/**
 * Seed Skull King rounds 2–9 directly via the score API so we can
 * jump straight to round 10 without driving the UI through 18 phases.
 *
 * Each round writes one row per player with the full
 * `SkullKingRoundEntry` shape in metadata; the scorer reads it back
 * via `parseRoundCategory("round_N")` and recomputes totals client-
 * side. The hardcoded picks below give the three players visibly
 * different running totals so the scoreboard/result screens have
 * interesting state to render.
 */
async function seedSkullKingRounds(
  page: Page,
  matchId: string,
  ids: { aliceId: string; bobId: string; charlieId: string },
) {
  const { aliceId, bobId, charlieId } = ids;

  // Per-round picks. bid+tricks fully determine the round score; the
  // other entry fields stay zero (no 14s/mermaid/etc. shenanigans —
  // the design brief doesn't need every bonus permutation seeded).
  const picks: Record<
    number,
    { alice: [number, number]; bob: [number, number]; charlie: [number, number] }
  > = {
    2: { alice: [1, 1], bob: [1, 0], charlie: [0, 1] }, // hit, miss, miss
    3: { alice: [2, 2], bob: [1, 1], charlie: [0, 0] }, // all hit
    4: { alice: [2, 2], bob: [3, 1], charlie: [1, 1] }, // hit, miss, hit
    5: { alice: [3, 3], bob: [2, 2], charlie: [0, 0] }, // all hit
    6: { alice: [2, 2], bob: [4, 4], charlie: [0, 0] }, // all hit
    7: { alice: [4, 3], bob: [3, 3], charlie: [0, 1] }, // miss, hit, miss
    8: { alice: [5, 5], bob: [2, 2], charlie: [1, 1] }, // all hit
    9: { alice: [4, 4], bob: [3, 4], charlie: [2, 1] }, // hit, miss, miss
  };

  const seatToId = (seat: "alice" | "bob" | "charlie") =>
    seat === "alice" ? aliceId : seat === "bob" ? bobId : charlieId;

  const rows: {
    playerId: string;
    category: string;
    value: number;
    metadata: Record<string, number>;
  }[] = [];
  for (const [roundStr, seats] of Object.entries(picks)) {
    const round = Number(roundStr);
    for (const seat of ["alice", "bob", "charlie"] as const) {
      const [bid, tricks] = seats[seat];
      // Client-side scoring approximation matching `scoreSkullKingRound`
      // for the basic hit/miss case: bid > 0 hit → bid × 20; bid 0 hit
      // → round × 10; miss → -|bid - tricks| × 10. Bonus fields stay 0.
      let value: number;
      if (bid === tricks) {
        value = bid === 0 ? round * 10 : bid * 20;
      } else {
        value = -Math.abs(bid - tricks) * 10;
      }
      rows.push({
        playerId: seatToId(seat),
        category: `round_${round}`,
        value,
        metadata: {
          bid,
          tricks,
          color14: 0,
          black14: 0,
          mermaidByPirate: 0,
          pirateBySK: 0,
          skByMermaid: 0,
        },
      });
    }
  }

  const res = await page.context().request.patch(
    `/api/matches/${matchId}/scores`,
    { data: { scores: rows } },
  );
  if (!res.ok()) {
    throw new Error(
      `seedSkullKingRounds(${matchId}) -> ${res.status()} ${await res.text()}`,
    );
  }
}

async function capturePlayersAndProfile(
  page: Page,
  suffix: string,
  friends: SeededFriend[],
) {
  await page.goto(`${BASE_URL}/players`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='players-list']");
  await shoot(page, `20-players-list${suffix}`);

  // "+Add profile" expanded.
  await page.click("[data-testid='players-add-profile']");
  await page.waitForSelector("[data-testid='players-add-profile-form']");
  await page.fill("[data-testid='players-add-profile-input']", "New friend");
  await page.waitForTimeout(120);
  await shoot(page, `21-players-add-profile${suffix}`);
  // Close without submitting so we don't accumulate spurious profiles.
  await page.keyboard.press("Escape").catch(() => {});
  // The form doesn't bind Escape; fall back to reloading the list.
  await page.goto(`${BASE_URL}/players`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='players-list']");

  // Profile detail for first friend — fully populated (stats + recent).
  const target = friends[0];
  await page.goto(`${BASE_URL}/players/${target.id}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='profile-edit-avatar']");
  await page.waitForTimeout(200);
  await shoot(page, `22-profile-detail${suffix}`);
}

async function captureAvatarUploader(page: Page, suffix: string, friend: SeededFriend) {
  await page.goto(`${BASE_URL}/players/${friend.id}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='profile-edit-avatar']");

  // Open the editor.
  await page.click("[data-testid='profile-edit-avatar']");
  await page.waitForSelector("[data-testid='avatar-uploader']");
  await page.waitForTimeout(150);
  await shoot(page, `23-avatar-uploader-idle${suffix}`);

  // Camera mode. The stubbed getUserMedia returns a canvas stream;
  // wait for the video element to start playing before screenshotting.
  await page.click("[data-testid='avatar-open-camera']");
  await page.waitForSelector("[data-testid='avatar-camera-capture']");
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return v instanceof HTMLVideoElement && v.readyState >= 2;
  }, { timeout: 5_000 }).catch(() => { /* still capture even if readyState stalls */ });
  await page.waitForTimeout(400);
  await shoot(page, `24-avatar-uploader-camera${suffix}`);

  // Exit cleanly so the camera shuts down before the next screen.
  await page.click("[data-testid='avatar-camera-cancel']");
  await page.click("[data-testid='avatar-done']").catch(() => {});
}

async function captureLinkSurfaces(page: Page, suffix: string, friend: SeededFriend) {
  await page.goto(`${BASE_URL}/players/${friend.id}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='profile-link-show']");

  // QR display.
  await page.click("[data-testid='profile-link-show']");
  // QR is drawn into a canvas once the /link-token POST resolves.
  await page.waitForFunction(() => {
    const c = document.querySelector("canvas");
    if (!(c instanceof HTMLCanvasElement)) return false;
    const ctx = c.getContext("2d");
    if (!ctx) return false;
    try {
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      // Any non-transparent pixel means the QR has rendered.
      for (let i = 3; i < d.length; i += 1024) if (d[i] !== 0) return true;
      return false;
    } catch {
      // Stub canvases without a real backing context — still proceed.
      return true;
    }
  }, { timeout: 5_000 }).catch(() => { /* capture anyway */ });
  await page.waitForTimeout(200);
  await shoot(page, `25-link-code-display${suffix}`);

  // Back out and open scanner.
  await page.goto(`${BASE_URL}/players/${friend.id}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='profile-link-scan']");
  await page.click("[data-testid='profile-link-scan']");
  await page.waitForSelector("[data-testid='link-scanner']");
  await page.waitForTimeout(800);
  // qr-scanner doesn't reliably attach the chromium fake-device stream
  // to its <video> in headless runs — its `start()` resolves cleanly
  // but the element ends up with no srcObject. For screenshot purposes
  // we don't need the QR-decode pipeline, just a viewport that looks
  // like a live camera, so we paint one in directly when qr-scanner
  // has left it empty.
  await page
    .evaluate(async () => {
      const video = document.querySelector(
        "[data-testid='link-scanner'] video",
      ) as HTMLVideoElement | null;
      if (!video || video.srcObject) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      await video.play();
    })
    .catch(() => { /* capture anyway */ });
  await page
    .waitForFunction(
      () => {
        const v = document.querySelector(
          "[data-testid='link-scanner'] video",
        ) as HTMLVideoElement | null;
        return !!v && v.readyState >= 2 && v.videoWidth > 0;
      },
      { timeout: 4_000 },
    )
    .catch(() => { /* capture anyway */ });
  await page.waitForTimeout(400);
  await shoot(page, `26-link-scanner${suffix}`);

  // Exit scanner.
  await page.goto(`${BASE_URL}/players/${friend.id}`);
  await page.waitForLoadState("domcontentloaded");
}

async function captureMergeDialog(page: Page, suffix: string, friend: SeededFriend) {
  await page.goto(`${BASE_URL}/players/${friend.id}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='profile-merge-action']");
  await page.click("[data-testid='profile-merge-action']");
  await page.waitForSelector("[role='dialog']").catch(() => {});
  await page.waitForTimeout(200);
  await shoot(page, `27-merge-dialog${suffix}`);
  await page.keyboard.press("Escape");
}

async function captureSettings(page: Page, theme: Theme, suffix: string) {
  await page.goto(`${BASE_URL}/settings`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("h1");
  // Re-assert theme + English in case prior steps changed them. Theme
  // pill labels are stable when the UI is in English.
  await ensureLanguage(page, "en");
  await ensureTheme(page, theme);
  await page.waitForSelector("[data-testid='profile-edit-avatar']");
  await shoot(page, `28-settings${suffix}`);

  // Open the avatar editor on the self-Profile — this is the only path
  // where the linked-avatar toggle is visible (self-Profile is linked
  // to the viewer), so the screenshot captures a distinct UI state.
  await page.click("[data-testid='profile-edit-avatar']");
  await page.waitForSelector("[data-testid='avatar-uploader']");
  await page.waitForTimeout(150);
  await shoot(page, `29-settings-avatar-editing${suffix}`);
  await page.click("[data-testid='avatar-done']").catch(() => {});

  await ensureLanguage(page, "fr");
  await shoot(page, `30-settings-french${suffix}`);
  await ensureLanguage(page, "en");
}

async function captureAuthPass(
  page: Page,
  theme: Theme,
  suffix: string,
  friends: SeededFriend[],
) {
  // Baseline: English + requested theme via Settings pills.
  await page.goto(`${BASE_URL}/settings`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("h1");
  await ensureLanguage(page, "en");
  await ensureTheme(page, theme);

  await captureGamesAndNewMatch(page, suffix, friends);
  await captureSevenWondersFlow(page, suffix);
  await captureSkullKingFlow(page, suffix);
  await capturePlayersAndProfile(page, suffix, friends);
  await captureAvatarUploader(page, suffix, friends[0]);
  await captureLinkSurfaces(page, suffix, friends[0]);
  await captureMergeDialog(page, suffix, friends[0]);
  await captureSettings(page, theme, suffix);
}

async function clearOutDir() {
  // Wipe so renumbered set doesn't sit next to orphaned old files.
  try {
    const entries = await fs.readdir(OUT_DIR);
    await Promise.all(
      entries
        .filter((f) => f.endsWith(".png"))
        .map((f) => fs.unlink(path.join(OUT_DIR, f))),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await clearOutDir();
  await killPort(PORT);

  console.log("Starting dev server (test mode)…");
  const server = startDevServer();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    await waitForPort(PORT);
    console.log("Dev server ready. Launching browser…");

    // `--use-fake-device-for-media-stream` injects a built-in synthetic
    // video stream so `getUserMedia` resolves without real camera
    // hardware, with `--use-fake-ui-for-media-stream` auto-granting the
    // permission. This drives both the avatar uploader's camera mode
    // and the QR scanner's viewport. The canvas-based stub previously
    // tried in `stubCamera` doesn't survive the video element's
    // `play()` promise reliably.
    browser = await chromium.launch({
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    const ctx = await browser.newContext({
      ...devices["Pixel 5"],
      baseURL: BASE_URL,
      permissions: ["camera"],
    });
    const page = await ctx.newPage();

    await captureLoginScreens(page, "");
    await signUp(page);

    console.log("Seeding profiles + completed matches…");
    const { friends } = await seedData(page);

    for (const { theme, suffix } of PASSES) {
      console.log(`Pass: ${theme}`);
      await captureAuthPass(page, theme, suffix, friends);
    }

    await captureLoginScreens(page, "-dark");

    console.log(`Captured screenshots into ${OUT_DIR}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        /* group may already be gone */
      }
    }
    await killPort(PORT);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
