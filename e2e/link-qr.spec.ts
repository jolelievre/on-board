import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * UI E2E for the Phase 6-C link-to-account flow.
 *
 * Camera-driven QR scanning isn't viable in Playwright (headless
 * Chrome refuses `getUserMedia` over plain http, and there's no way
 * to feed a synthesised QR frame). `LinkScanner` exposes a test-only
 * `window.__onboardSubmitLinkToken(token)` hook that mounts while
 * the scanner is alive — these tests drive that hook directly.
 *
 * Each test runs from a clean slate by spinning two BrowserContexts
 * (owner + friend), signing up each via the email/password form,
 * and using the resulting session cookies for both API setup and
 * the in-page navigation that exercises the UI.
 */

type SignUp = {
  email: string;
  password: string;
  name: string;
};

let counter = 0;
function uniqueUser(): SignUp {
  counter += 1;
  const id = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `link-${id}@example.com`,
    password: "testpassword123",
    name: `Link User ${counter}`,
  };
}

async function signUp(ctx: BrowserContext): Promise<SignUp> {
  const user = uniqueUser();
  const res = await ctx.request.post("/api/auth/sign-up/email", {
    data: {
      email: user.email,
      password: user.password,
      name: user.name,
    },
  });
  if (!res.ok())
    throw new Error(`Sign-up failed ${res.status()} ${await res.text()}`);
  return user;
}

async function getMe(req: APIRequestContext): Promise<{
  id: string;
  name: string;
  email: string;
}> {
  const res = await req.get("/api/auth/get-session");
  const body = await res.json();
  return body.user;
}

async function getLinkToken(req: APIRequestContext): Promise<string> {
  const res = await req.post("/api/profiles/link-token");
  if (!res.ok())
    throw new Error(`link-token failed ${res.status()}: ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function createUnclaimedProfile(
  req: APIRequestContext,
  alias: string,
): Promise<{ id: string; alias: string }> {
  const res = await req.post("/api/profiles", {
    data: { alias },
  });
  if (!res.ok())
    throw new Error(`profile create failed ${res.status()}: ${await res.text()}`);
  const body = (await res.json()) as { id: string; alias: string };
  return body;
}

/** Wait for the LinkScanner's window-level submit hook to mount,
 * then call it with the given token. The hook stops the camera
 * stream itself, so this works whether or not getUserMedia
 * succeeded. */
async function submitTokenViaHook(page: Page, token: string) {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __onboardSubmitLinkToken?: unknown })
        .__onboardSubmitLinkToken === "function",
    null,
    { timeout: 5000 },
  );
  await page.evaluate(async (t) => {
    const w = window as unknown as {
      __onboardSubmitLinkToken: (token: string) => Promise<void>;
    };
    await w.__onboardSubmitLinkToken(t);
  }, token);
}

/** Open a player profile's detail page directly by id — avoids
 * having to find the row in the list. */
async function openProfile(page: Page, profileId: string) {
  await page.goto(`/players/${profileId}`);
  await page.waitForLoadState("domcontentloaded");
}

test.describe("Profile detail — QR link flow", () => {
  test("scanning a friend's link code binds the profile + creates a bilateral reverse profile + surfaces email", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      const friend = await signUp(friendCtx);
      const friendMe = await getMe(friendCtx.request);

      const owner = await signUp(ownerCtx);
      const ownerMe = await getMe(ownerCtx.request);
      const alice = await createUnclaimedProfile(ownerCtx.request, "Alice");

      const ownerPage = await ownerCtx.newPage();
      await openProfile(ownerPage, alice.id);

      await ownerPage.click("[data-testid='profile-link']");
      await expect(
        ownerPage.locator("[data-testid='link-scanner']"),
      ).toBeVisible();

      const token = await getLinkToken(friendCtx.request);
      await submitTokenViaHook(ownerPage, token);

      // The scanner stays mounted (parent keeps it open across the
      // `isLinked` transition) so the success banner is observable.
      await expect(
        ownerPage.locator("[data-testid='link-scanner-linked']"),
      ).toBeVisible();
      await ownerPage.click("[data-testid='link-scanner'] >> text=Done");

      // The linked-friend card now shows the friend's name + email
      // — proof the projection lands in the UI.
      await expect(ownerPage.locator(`text=${friend.email}`)).toBeVisible();

      // Friend's /api/profiles now includes a bilateral reverse
      // profile (owned by friend, linked to owner) with the owner's
      // name as alias. The check goes through the API since the
      // friend's browser context doesn't have a page open.
      const friendProfiles = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as { ownerId: string; linkedUserId: string; alias: string }[];
      const reverse = friendProfiles.find(
        (p) =>
          p.ownerId === friendMe.id && p.linkedUserId === ownerMe.id,
      );
      expect(reverse).toBeDefined();
      expect(reverse?.alias).toBe(owner.name);
      // Friend's self-profile is still there, untouched.
      const selfStill = friendProfiles.find(
        (p) => p.ownerId === friendMe.id && p.linkedUserId === friendMe.id,
      );
      expect(selfStill?.alias).toBe(friend.name);

      // Single-self-profile invariant on the friend's Players UI.
      const friendPage = await friendCtx.newPage();
      await friendPage.goto("/players");
      await friendPage.waitForLoadState("domcontentloaded");
      const youPills = friendPage.locator(
        "[data-testid='player-row'] >> text=you",
      );
      await expect(youPills).toHaveCount(1);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("scanner reports the merge_required branch and the merge consolidates the duplicates", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      await signUp(ownerCtx);

      const alice = await createUnclaimedProfile(ownerCtx.request, "Alice");
      const aleece = await createUnclaimedProfile(ownerCtx.request, "Aleece");

      const ownerPage = await ownerCtx.newPage();

      // First link: Alice → friend, via the UI.
      await openProfile(ownerPage, alice.id);
      await ownerPage.click("[data-testid='profile-link']");
      await submitTokenViaHook(
        ownerPage,
        await getLinkToken(friendCtx.request),
      );
      await expect(
        ownerPage.locator("[data-testid='link-scanner-linked']"),
      ).toBeVisible();
      await ownerPage.click("[data-testid='link-scanner'] >> text=Done");

      // Second link: Aleece → same friend → merge_required.
      await openProfile(ownerPage, aleece.id);
      await ownerPage.click("[data-testid='profile-link']");
      await submitTokenViaHook(
        ownerPage,
        await getLinkToken(friendCtx.request),
      );

      const prompt = ownerPage.locator(
        "[data-testid='link-scanner-merge-required']",
      );
      await expect(prompt).toBeVisible();
      await expect(prompt).toContainText("Alice");
      await expect(prompt).toContainText("Aleece");

      await ownerPage.click("[data-testid='link-scanner-merge-confirm']");
      // Scanner triggers a navigation to the survivor — the
      // merge-time "merged" banner is no longer rendered (the
      // navigation lets the survivor page take over directly,
      // avoiding the "profile not found" flash that would
      // otherwise occur between the local Dexie delete and the
      // route change). We assert the end state on the server.
      await ownerPage.waitForURL(
        new RegExp(`/players/${alice.id}$`),
        { timeout: 5000 },
      );

      // The merge POST is sync-queued; poll the server until the
      // source profile is gone rather than racing the flush.
      await expect
        .poll(
          async () => {
            const res = await ownerCtx.request.get("/api/profiles");
            const list = (await res.json()) as { id: string }[];
            return list.some((p) => p.id === aleece.id);
          },
          { timeout: 5000 },
        )
        .toBe(false);

      // And the survivor is still linked.
      const visible = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as { id: string; linkedUserId: string | null }[];
      const survivor = visible.find((p) => p.id === alice.id);
      expect(survivor).toBeDefined();
      expect(survivor?.linkedUserId).not.toBeNull();
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("scanning your own QR is refused inline", async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      await signUp(ctx);
      const profile = await createUnclaimedProfile(ctx.request, "Mirror");

      const page = await ctx.newPage();
      await openProfile(page, profile.id);

      await page.click("[data-testid='profile-link']");
      await expect(
        page.locator("[data-testid='link-scanner']"),
      ).toBeVisible();

      const ownToken = await getLinkToken(ctx.request);
      await submitTokenViaHook(page, ownToken);

      await expect(
        page.locator("[data-testid='link-scanner-error']"),
      ).toBeVisible();
      // Retry control is offered so the user isn't stuck.
      await expect(
        page.locator("[data-testid='link-scanner-retry']"),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("unlink from the friend's side removes the profile from their list", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      await signUp(ownerCtx);

      const alice = await createUnclaimedProfile(ownerCtx.request, "Alice");

      const ownerPage = await ownerCtx.newPage();
      await openProfile(ownerPage, alice.id);
      await ownerPage.click("[data-testid='profile-link']");
      await submitTokenViaHook(
        ownerPage,
        await getLinkToken(friendCtx.request),
      );
      await expect(
        ownerPage.locator("[data-testid='link-scanner-linked']"),
      ).toBeVisible();
      await ownerPage.click("[data-testid='link-scanner'] >> text=Done");

      // Friend opens "Alice" from their list — they see it because
      // linkedUserId points at them. The Unlink button must be
      // available from the friend side (either party can sever).
      const friendPage = await friendCtx.newPage();
      await friendPage.goto(`/players/${alice.id}`);
      await friendPage.waitForLoadState("domcontentloaded");
      await expect(
        friendPage.locator("[data-testid='profile-unlink']"),
      ).toBeVisible();
      await friendPage.click("[data-testid='profile-unlink']");
      // Wait for the mutation to settle: when the friend unlinks
      // themself, `asLinkedUser: true` deletes the local Dexie row
      // and the page transitions out of the linked-friend card.
      // The unlink button disappearing is the right signal that
      // the round-trip has completed.
      await expect(
        friendPage.locator("[data-testid='profile-unlink']"),
      ).toHaveCount(0);

      // Server view: profile no longer in the friend's visibility set.
      const friendProfiles = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as { id: string }[];
      expect(friendProfiles.some((p) => p.id === alice.id)).toBe(false);

      // Owner view: profile is back to unclaimed.
      const ownerProfiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as { id: string; linkedUserId: string | null }[];
      const aliceAfter = ownerProfiles.find((p) => p.id === alice.id);
      expect(aliceAfter).toBeDefined();
      expect(aliceAfter?.linkedUserId).toBeNull();
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });
});
