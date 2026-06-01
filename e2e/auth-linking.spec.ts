import { test, expect } from "@playwright/test";
import { loginWithFacebook } from "./helpers/auth";

/**
 * Cross-provider account linking — a user who first signed up via
 * Google should land on the SAME `User` row when they later sign in via
 * Facebook with the matching email. Per the better-auth config in
 * src/server/lib/auth.ts: `account.accountLinking.trustedProviders =
 * ["google","facebook","apple"]`.
 *
 * Constraints:
 *  - Requires Google + Facebook test accounts sharing the same email.
 *  - Requires the deploy to have BOTH provider credentials configured.
 *  - CI doesn't have these, so the suite skips by default. To run
 *    locally against integration:
 *      GOOGLE_TEST_EMAIL=... GOOGLE_TEST_PASSWORD=... \
 *      FACEBOOK_TEST_EMAIL=<same-email> FACEBOOK_TEST_PASSWORD=... \
 *      BASE_URL=https://on-board-preview.jolelievre.com \
 *      npm run test:chrome -- auth-linking
 */
test.describe("Account linking — Google ↔ Facebook same email", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Skip the whole describe when we don't have credentials for both.
  test.skip(
    !process.env.GOOGLE_TEST_EMAIL ||
      !process.env.GOOGLE_TEST_PASSWORD ||
      !process.env.FACEBOOK_TEST_EMAIL ||
      !process.env.FACEBOOK_TEST_PASSWORD ||
      process.env.GOOGLE_TEST_EMAIL !== process.env.FACEBOOK_TEST_EMAIL,
    "Requires Google + Facebook test accounts with the same email. " +
      "Set GOOGLE_TEST_EMAIL/PASSWORD and FACEBOOK_TEST_EMAIL/PASSWORD " +
      "(same email on both) to enable.",
  );

  test("Facebook sign-in after Google reuses the same User", async ({
    page,
    context,
  }) => {
    // Step 1 — sign in via Google. Captures the User id from the session.
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.click("text=Sign in with Google");
    // (Google login flow happens here; reuse the loginWithGoogle internals
    //  would require exposing them — for now we let the user-managed
    //  setup take over via the storage-state-clean context.)
    await page.waitForURL("**/games", { timeout: 60000 });

    const googleSession = await fetchSession(page);
    expect(googleSession.user.id).toBeTruthy();
    const userId = googleSession.user.id as string;

    // Sign out + clear storage to ensure the Facebook sign-in is a
    // fresh flow rather than a session-extension.
    await page.goto("/settings");
    await page.click("text=Sign out");
    await page.waitForURL("/", { timeout: 10000 });
    await context.clearCookies();

    // Step 2 — sign in via Facebook with the same email.
    await loginWithFacebook(page);
    const facebookSession = await fetchSession(page);

    // Step 3 — the linked User id must match.
    expect(facebookSession.user.id).toBe(userId);
    // The self-Profile is keyed on userId so there's only one.
    const profiles = await page
      .request.get("/api/profiles?include=self")
      .then((r) => r.json() as Promise<Array<{ linkedUserId: string | null }>>);
    const selfProfiles = profiles.filter((p) => p.linkedUserId === userId);
    expect(selfProfiles).toHaveLength(1);
  });
});

async function fetchSession(page: import("@playwright/test").Page) {
  const res = await page.request.get("/api/auth/get-session");
  return (await res.json()) as { user: { id: string; email: string } };
}
