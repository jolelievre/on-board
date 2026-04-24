import type { APIRequestContext, Page } from "@playwright/test";

let userCounter = 0;

function uniqueTestUser() {
  userCounter++;
  const id = `${Date.now()}-${userCounter}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `test-${id}@example.com`,
    password: "testpassword123",
    name: `Test User ${userCounter}`,
  };
}

/**
 * Login adapter — auto-detects the available auth method:
 * - If the email/password form is visible (test mode) → use it
 * - Otherwise → use Google OAuth (needs GOOGLE_TEST_EMAIL/PASSWORD env vars)
 *
 * After login, the page is on /games.
 */
export async function login(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // Wait for the login page to fully render
  await page.waitForSelector("h1", { timeout: 10000 });

  // Detect which auth method is available
  const hasTestAuth = await page
    .locator("input[name='email']")
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (hasTestAuth) {
    await loginWithTestAuth(page);
    return;
  }

  const hasGoogle = await page
    .locator("text=Sign in with Google")
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (hasGoogle) {
    await loginWithGoogle(page);
    return;
  }

  throw new Error("No auth method available on the login page");
}

/**
 * Login via the test email/password form.
 * Available when VITE_TEST_AUTH=true and NODE_ENV=test.
 */
async function loginWithTestAuth(page: Page) {
  const user = uniqueTestUser();

  await page.fill("input[name='name']", user.name);
  await page.fill("input[name='email']", user.email);
  await page.fill("input[name='password']", user.password);
  await page.click("button[type='submit']");

  await page.waitForURL("**/games", { timeout: 10000 });
}

/**
 * Login via Google OAuth.
 * Requires GOOGLE_TEST_EMAIL and GOOGLE_TEST_PASSWORD env vars.
 */
async function loginWithGoogle(page: Page) {
  const email = process.env.GOOGLE_TEST_EMAIL;
  const password = process.env.GOOGLE_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Google OAuth login requires GOOGLE_TEST_EMAIL and GOOGLE_TEST_PASSWORD env vars. " +
      "Set them in .env.test.local",
    );
  }

  // Click the Google sign-in button — redirects to Google
  await page.click("text=Sign in with Google");

  // Wait for Google login page
  await page.waitForURL("**/accounts.google.com/**", { timeout: 15000 });

  // Enter email
  await page.fill('input[type="email"]', email);
  await page.click("#identifierNext");

  // Wait for password page
  await page.waitForSelector('input[type="password"]', {
    state: "visible",
    timeout: 10000,
  });

  // Enter password
  await page.fill('input[type="password"]', password);
  await page.click("#passwordNext");

  // Wait for redirect back to the app
  await page.waitForURL("**/games", { timeout: 30000 });
}

/**
 * Returns true if the current environment uses test auth (email/password).
 * Useful for conditionally skipping auth-method-specific tests.
 */
export function isTestAuthMode(): boolean {
  return !process.env.BASE_URL || process.env.VITE_TEST_AUTH === "true";
}

/**
 * Sign up + sign in via API request context.
 * Only works in test auth mode (email/password enabled).
 * Use this for API-only tests where no browser page is needed.
 */
export async function createAndSignIn(request: APIRequestContext) {
  const user = uniqueTestUser();

  const signUpRes = await request.post("/api/auth/sign-up/email", {
    data: {
      email: user.email,
      password: user.password,
      name: user.name,
    },
  });

  if (!signUpRes.ok()) {
    throw new Error(
      `Sign up failed: ${signUpRes.status()} ${await signUpRes.text()}`,
    );
  }

  return user;
}
