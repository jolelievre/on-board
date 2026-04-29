/**
 * Captures mobile-viewport (Pixel 5) screenshots of every current screen into
 * `plan-assets/screenshots/` to ship with the Phase 3 design brief.
 *
 * Both themes are captured in a single run: each authenticated screen produces
 * a parchment (light, no suffix) and a candlelit (dark, `-dark` suffix) PNG.
 *
 * Standalone — not part of the E2E test campaign. Run via:
 *   npm run screenshots
 *
 * The npm script resets the test DB first, then this script:
 *   1. Boots a fresh Vite dev server in test mode (VITE_TEST_AUTH=true, NODE_ENV=test)
 *   2. Captures the signed-out login screens in parchment
 *   3. Signs up a throwaway test user via the dev-only email/password form
 *   4. Walks the app twice (parchment then candlelit), capturing one PNG per
 *      screen per theme. The theme is flipped via the real Settings toggle so
 *      the change persists server-side and the session-sync effect doesn't
 *      fight a localStorage-only override.
 *   5. Signs out and captures the login screens in candlelit
 *      (localStorage carries the theme across the sign-out)
 *   6. Tears the dev server down
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

// Click a PillSwitch radio button by its visible label. Used for both the
// language and theme toggles on /settings, which both render as
// `button[role='radio']` with stable label text (English/Français and, when
// the UI is in English, Parchment/Candlelit).
async function clickPillOption(page: Page, label: string) {
  const button = page
    .locator("button[role='radio']", { hasText: new RegExp(`^${label}$`) })
    .first();
  if ((await button.getAttribute("aria-checked")) === "true") return;
  await button.click();
}

async function ensureLanguage(page: Page, lang: "en" | "fr") {
  await clickPillOption(page, lang === "en" ? "English" : "Français");
  // i18next swap is sync but DOM updates land on next tick.
  await page.waitForTimeout(200);
}

async function ensureTheme(page: Page, theme: Theme) {
  const current = await page.evaluate(() => document.documentElement.dataset.theme);
  if (current === theme) return;
  // ThemeToggle labels are translated; only stable when the UI is in English.
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

async function captureLoginScreens(page: Page, suffix: string) {
  await page.context().clearCookies();
  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("h1");

  // (a) dev variant — the email/password form actually rendered here.
  await shoot(page, `01-login-dev${suffix}`);

  // (b) production variant — swap the test form for the real Google button
  // via DOM only, so the design session sees what real users encounter.
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

async function captureScoringFlow(page: Page, suffix: string) {
  const p1 = "Alice";
  const p2 = "Bob";

  await page.goto(`${BASE_URL}/games/7-wonders-duel/new`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill("[data-testid='new-match-player-0']", p1);
  await page.fill("[data-testid='new-match-player-1']", p2);
  // Dismiss the autocomplete dropdown that opened on the last filled input —
  // its chips appear below the input and shift layout while the click
  // resolves, which can race the submit click in pass 2 where prior players
  // have populated the suggestions list.
  await page.locator("[data-testid='new-match-player-1']").blur();
  await page.click("[data-testid='new-match-submit']");
  await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
  await page.waitForSelector("[data-testid^='score-grid-player-']");

  await shoot(page, `05-scoring-empty${suffix}`);

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

  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid='save-status']")
        ?.getAttribute("data-status") === "saved",
    { timeout: 5_000 },
  );

  await shoot(page, `06-scoring-filled${suffix}`);

  await page.click("[data-testid='complete-match']");
  await page.waitForSelector("[data-testid='winner-banner']");
  await shoot(page, `07-match-completed${suffix}`);

  await page.click("[data-testid='back-to-game']");
  await page.waitForURL(`${BASE_URL}/games/7-wonders-duel`);
  await page.waitForSelector("[data-testid='match-history']");
  await shoot(page, `08-game-detail-with-history${suffix}`);
}

async function captureAuthScreens(page: Page, theme: Theme, suffix: string) {
  // Establish baseline: English language (so the theme button labels are
  // stable) and the requested theme. Both pill toggles live on /settings.
  await page.goto(`${BASE_URL}/settings`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("h1");
  await ensureLanguage(page, "en");
  await ensureTheme(page, theme);

  await page.goto(`${BASE_URL}/games`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("h1");
  await shoot(page, `02-games-list${suffix}`);

  await page.goto(`${BASE_URL}/games/7-wonders-duel`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='new-match-button']");
  await shoot(page, `03-game-detail-empty${suffix}`);

  await page.goto(`${BASE_URL}/games/7-wonders-duel/new`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("[data-testid='new-match-player-0']");
  await shoot(page, `04-new-match-form${suffix}`);

  await captureScoringFlow(page, suffix);

  await page.goto(`${BASE_URL}/settings`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("h1");
  await shoot(page, `09-settings${suffix}`);

  await ensureLanguage(page, "fr");
  await shoot(page, `10-settings-french${suffix}`);

  // Reset language so the next pass (or the post-loop login capture) starts
  // from a known English baseline.
  await ensureLanguage(page, "en");
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await killPort(PORT);

  console.log("Starting dev server (test mode)…");
  const server = startDevServer();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    await waitForPort(PORT);
    console.log("Dev server ready. Launching browser…");

    browser = await chromium.launch();
    const ctx = await browser.newContext({ ...devices["Pixel 5"] });
    const page = await ctx.newPage();

    // Signed-out, parchment (default theme on a fresh visit).
    await captureLoginScreens(page, "");

    // Sign up — server defaults user.theme to "parchment".
    await signUp(page);

    // Authenticated screens, both themes.
    for (const { theme, suffix } of PASSES) {
      await captureAuthScreens(page, theme, suffix);
    }

    // Signed-out, candlelit. The Settings toggle persisted candlelit to
    // localStorage; clearing cookies in captureLoginScreens drops the session
    // but keeps localStorage, so the login page renders in dark.
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
