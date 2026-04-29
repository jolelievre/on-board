/**
 * Captures candlelit (dark) theme screenshots.
 * Boots the dev server, signs up, toggles theme, walks key screens.
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
  throw new Error(`Dev server did not come up on port ${port}`);
}

async function killPort(port: number) {
  await new Promise<void>((resolve) => {
    const k = spawn("sh", ["-c", `lsof -ti :${port} | xargs kill -9 2>/dev/null; true`]);
    k.on("close", () => resolve());
  });
}

function startDevServer(): ChildProcess {
  return spawn("npx", ["vite"], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: "test", VITE_TEST_AUTH: "true" },
    stdio: "inherit",
    detached: true,
  });
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
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await killPort(PORT);

  console.log("Starting dev server (test mode)…");
  const server = startDevServer();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    await waitForPort(PORT);
    browser = await chromium.launch();
    const ctx = await browser.newContext({ ...devices["Pixel 5"] });
    const page = await ctx.newPage();

    // Pre-seed candlelit theme into localStorage so the unauthenticated
    // login screen renders dark before the user has any account.
    await page.addInitScript(() => {
      window.localStorage.setItem("ob.theme", "candlelit");
    });

    // Sign up — note: server defaults user.theme to "parchment", which the
    // ThemeContext will then sync down. We toggle back to candlelit via the
    // Settings UI right after sign-up so authenticated screens stay dark.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("input[name='email']");
    await shoot(page, "01-login-dev-dark");

    await page.fill("input[name='name']", "Test User");
    await page.fill("input[name='email']", `dark-${stamp}@example.com`);
    await page.fill("input[name='password']", "testpassword123");
    await page.click("button[type='submit']");
    await page.waitForURL(`${BASE_URL}/games`, { timeout: 10_000 });

    // Persist candlelit on the server too, so subsequent screens stay dark.
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("h1");
    const candlelitButton = page
      .locator('[role="radio"]')
      .filter({ hasText: /Candlelit|Chandelle/ })
      .first();
    await candlelitButton.click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "candlelit",
    );
    await shoot(page, "09-settings-dark");

    await page.goto(`${BASE_URL}/games`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("h1");
    await shoot(page, "02-games-list-dark");

    await page.goto(`${BASE_URL}/games/7-wonders-duel`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("[data-testid='new-match-button']");
    await shoot(page, "03-game-detail-empty-dark");

    await page.goto(`${BASE_URL}/games/7-wonders-duel/new`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("[data-testid='new-match-player-0']");
    await shoot(page, "04-new-match-form-dark");

    // Score flow
    await page.fill("[data-testid='new-match-player-0']", "Alice");
    await page.fill("[data-testid='new-match-player-1']", "Bob");
    await page.click("[data-testid='new-match-submit']");
    await page.waitForURL(/\/matches\/[a-z0-9-]+/i);
    await page.waitForSelector("[data-testid^='score-grid-player-']");
    await shoot(page, "05-scoring-empty-dark");

    const playerId = (name: string) =>
      page
        .locator(`[data-testid^='score-grid-player-'] >> text=${name}`)
        .first()
        .evaluate((el) => el.getAttribute("data-testid")!.replace("score-grid-player-", ""));

    const p1Id = await playerId("Alice");
    const p2Id = await playerId("Bob");

    const fill = async (pid: string, cat: string, value: number) => {
      const input = page.locator(`[data-testid='score-input-${pid}-${cat}']`);
      await input.fill(String(value));
      await input.blur();
    };
    await fill(p1Id, "civil", 8);
    await fill(p1Id, "scientific", 6);
    await fill(p1Id, "wonders", 5);
    await fill(p1Id, "treasury", 7);
    await fill(p2Id, "civil", 4);
    await fill(p2Id, "scientific", 9);
    await fill(p2Id, "wonders", 3);
    await fill(p2Id, "guilds", 4);

    await page.waitForFunction(
      () =>
        document.querySelector("[data-testid='save-status']")?.getAttribute("data-status") ===
        "saved",
      { timeout: 5_000 },
    );
    await shoot(page, "06-scoring-filled-dark");

    await page.click("[data-testid='complete-match']");
    await page.waitForSelector("[data-testid='winner-banner']");
    await shoot(page, "07-match-completed-dark");

    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("h1");
    await shoot(page, "09-settings-dark");

    console.log(`Captured candlelit screenshots into ${OUT_DIR}`);
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
