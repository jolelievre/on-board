import type { APIRequestContext, Page } from "@playwright/test";

let userCounter = 0;

export function uniqueTestUser() {
  userCounter++;
  const id = `${Date.now()}-${userCounter}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `test-${id}@example.com`,
    password: "testpassword123",
    name: `Test User ${userCounter}`,
  };
}

/**
 * Sign up + sign in via API request context.
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

/**
 * Sign up + sign in via the browser UI form.
 * Use this for browser-based tests where the page needs the session cookie.
 */
export async function loginViaUI(page: Page) {
  const user = uniqueTestUser();

  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  await page.fill("input[name='name']", user.name);
  await page.fill("input[name='email']", user.email);
  await page.fill("input[name='password']", user.password);
  await page.click("button[type='submit']");

  // Wait for redirect to /games
  await page.waitForURL("**/games", { timeout: 10000 });

  return user;
}
