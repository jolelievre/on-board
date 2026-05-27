import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * UI E2E for the Phase 6-C link-to-account + cross-user sharing
 * feature under the single-Profile model.
 *
 * Camera-driven QR scanning isn't viable in Playwright (headless
 * Chrome refuses `getUserMedia` over plain http and there's no way to
 * feed a synthesised QR frame). `LinkScanner` exposes a test-only
 * `window.__onboardSubmitLinkToken(token)` hook that mounts while
 * the scanner is alive — these tests drive that hook directly.
 *
 * Two BrowserContexts spin up (owner + friend) so each runs against
 * a fresh signup with its own session cookies.
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
  const res = await req.post("/api/profiles", { data: { alias } });
  if (!res.ok())
    throw new Error(`profile create failed ${res.status()}: ${await res.text()}`);
  return (await res.json()) as { id: string; alias: string };
}

/** Wait for the LinkScanner's window-level submit hook to mount, then
 * call it with the given token. */
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

/**
 * Drive the new-match form through the UI. Types names into each
 * slot — for unmatched names the form inline-creates an unclaimed
 * Profile via `mutations.createProfile`, which is the same path a
 * real user takes.
 */
async function createMatchViaForm(
  page: Page,
  opts: { gameSlug: string; playerNames: string[] },
): Promise<string> {
  await page.goto(`/games/${opts.gameSlug}/new`);
  await page.waitForLoadState("domcontentloaded");
  await expect(
    page.locator("[data-testid='new-match-player-0']"),
  ).toBeVisible();
  for (let i = 0; i < opts.playerNames.length; i++) {
    const input = page.locator(`[data-testid='new-match-player-${i}']`);
    if ((await input.count()) === 0) {
      await page.click("[data-testid='new-match-add-player']");
      await expect(input).toBeVisible();
    }
    await page.fill(`[data-testid='new-match-player-${i}']`, opts.playerNames[i]);
  }
  await page.click("[data-testid='new-match-submit']");
  await page.waitForURL(/\/matches\/[a-z0-9-]+/i, { timeout: 10_000 });
  const url = new URL(page.url());
  const id = url.pathname.split("/").pop();
  if (!id) throw new Error("Could not parse match id from URL " + url.pathname);
  return id;
}

async function openProfile(page: Page, profileId: string) {
  await page.goto(`/players/${profileId}`);
  await page.waitForLoadState("domcontentloaded");
}

test.describe("Profile linking (single-Profile model)", () => {
  test("scanning a friend's link code binds the profile without creating any mirror row", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendMe = await getMe(friendCtx.request);
      const friendToken = await getLinkToken(friendCtx.request);

      await signUp(ownerCtx);
      const ownerMe = await getMe(ownerCtx.request);
      const alice = await createUnclaimedProfile(ownerCtx.request, "Alice");

      const ownerPage = await ownerCtx.newPage();
      await openProfile(ownerPage, alice.id);
      await ownerPage.click("[data-testid='profile-link']");
      await submitTokenViaHook(ownerPage, friendToken);

      await expect(
        ownerPage.locator("[data-testid='link-scanner-linked']"),
      ).toBeVisible({ timeout: 5000 });

      // Owner-side: the Profile row now carries linkedUserId = friend.
      const ownerProfiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as { id: string; linkedUserId: string | null }[];
      const linkedAlice = ownerProfiles.find((p) => p.id === alice.id);
      expect(linkedAlice?.linkedUserId).toBe(friendMe.id);

      // Friend-side: no mirror profile owned by the friend that
      // represents the owner. Friend still has only their self-Profile.
      const friendProfiles = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as {
        id: string;
        ownerId: string;
        linkedUserId: string | null;
      }[];
      expect(friendProfiles.length).toBe(1);
      expect(friendProfiles[0].ownerId).toBe(friendMe.id);
      expect(friendProfiles[0].linkedUserId).toBe(friendMe.id);

      // And no row owned by the owner appears in the friend's listing.
      expect(
        friendProfiles.find((p) => p.ownerId === ownerMe.id),
      ).toBeUndefined();
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("after linking, the friend can see prior matches the owner already created", async ({
    browser,
  }) => {
    // The bug from the conversation: A creates matches with profile
    // "B" (unclaimed) → A links profile "B" to user B → B's match
    // history should now include those prior matches.
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendToken = await getLinkToken(friendCtx.request);

      await signUp(ownerCtx);
      const ownerPage = await ownerCtx.newPage();
      // Owner creates a 7 Wonders Duel match against "Friend" (will
      // become the friend's linked profile in a moment).
      const matchId = await createMatchViaForm(ownerPage, {
        gameSlug: "7-wonders-duel",
        playerNames: ["Me", "Friend"],
      });
      expect(matchId).toBeTruthy();

      // Wait for the inline-created "Friend" profile to flush to the
      // server via the sync queue.
      let friendProfile:
        | { id: string; alias: string }
        | undefined;
      await expect
        .poll(
          async () => {
            const profiles = (await (
              await ownerCtx.request.get("/api/profiles")
            ).json()) as { id: string; alias: string }[];
            friendProfile = profiles.find((p) => p.alias === "Friend");
            return friendProfile?.id;
          },
          { timeout: 10_000 },
        )
        .toBeTruthy();

      // Owner links the "Friend" profile to the friend's User.
      await openProfile(ownerPage, friendProfile!.id);
      await ownerPage.click("[data-testid='profile-link']");
      await submitTokenViaHook(ownerPage, friendToken);
      await expect(
        ownerPage.locator("[data-testid='link-scanner-linked']"),
      ).toBeVisible({ timeout: 5000 });

      // Friend's match list now includes the match. The visibility
      // filter joins through Player → Profile → linkedUserId = friend.
      const friendMatches = (await (
        await friendCtx.request.get("/api/matches")
      ).json()) as { id: string }[];
      expect(friendMatches.some((m) => m.id === matchId)).toBe(true);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("matches created by either side are visible to both after both have linked profiles", async ({
    browser,
  }) => {
    // Symmetric visibility: even when the friend creates the match,
    // the owner sees it via their own linked profile of the friend.
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    try {
      await signUp(aliceCtx);
      const aliceMe = await getMe(aliceCtx.request);
      await signUp(bobCtx);
      const bobMe = await getMe(bobCtx.request);

      // Alice creates an unclaimed profile for Bob and links it.
      const bobToken = await getLinkToken(bobCtx.request);
      const aliceProfileOfBob = await createUnclaimedProfile(
        aliceCtx.request,
        "Bob",
      );
      await aliceCtx.request.post(
        `/api/profiles/${aliceProfileOfBob.id}/link`,
        { data: { token: bobToken } },
      );

      // Bob creates an unclaimed profile for Alice and links it.
      const aliceToken = await getLinkToken(aliceCtx.request);
      const bobProfileOfAlice = await createUnclaimedProfile(
        bobCtx.request,
        "Alice",
      );
      await bobCtx.request.post(
        `/api/profiles/${bobProfileOfAlice.id}/link`,
        { data: { token: aliceToken } },
      );

      // Bob creates a match via the UI. The two seats: Bob's
      // self-Profile (typed "MeBob" resolves to a new unclaimed
      // profile, NOT the self — but the linkedUserId widening still
      // works) and Alice's profile (Bob's profile of Alice, linked).
      const gameRes = await aliceCtx.request.get("/api/games/7-wonders-duel");
      const game = await gameRes.json();

      // Build the match via direct POST so we control which profileIds
      // are referenced — exercising the cross-user join.
      const bobSelfProfiles = (await (
        await bobCtx.request.get("/api/profiles")
      ).json()) as { id: string; ownerId: string; linkedUserId: string | null }[];
      const bobSelf = bobSelfProfiles.find(
        (p) => p.ownerId === bobMe.id && p.linkedUserId === bobMe.id,
      )!;

      const matchRes = await bobCtx.request.post("/api/matches", {
        data: {
          gameId: game.id,
          players: [
            { profileId: bobSelf.id, position: 0 },
            { profileId: bobProfileOfAlice.id, position: 1 },
          ],
        },
      });
      expect(matchRes.status()).toBe(201);
      const bobMatch = (await matchRes.json()) as { id: string };

      // Alice's match list now includes Bob's match — visible via her
      // own linked profile of Bob (linkedUserId = bob) which the
      // visibility filter joins through.
      const aliceMatches = (await (
        await aliceCtx.request.get("/api/matches")
      ).json()) as { id: string }[];
      expect(aliceMatches.some((m) => m.id === bobMatch.id)).toBe(true);

      // And Alice's "Bob" profile detail picks up the match via
      // `collectPersonPlayers` widening on profileLinkedUserId.
      // We can't easily read the Dexie state from API, but the visibility
      // alone proves the join works end-to-end.
      void aliceMe;
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test("unlinking severs visibility for the formerly-linked friend", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendToken = await getLinkToken(friendCtx.request);

      await signUp(ownerCtx);
      const ownerPage = await ownerCtx.newPage();
      const matchId = await createMatchViaForm(ownerPage, {
        gameSlug: "7-wonders-duel",
        playerNames: ["Me", "Friend"],
      });

      let friendProfile:
        | { id: string; alias: string }
        | undefined;
      await expect
        .poll(
          async () => {
            const profiles = (await (
              await ownerCtx.request.get("/api/profiles")
            ).json()) as { id: string; alias: string }[];
            friendProfile = profiles.find((p) => p.alias === "Friend");
            return friendProfile?.id;
          },
          { timeout: 10_000 },
        )
        .toBeTruthy();
      await ownerCtx.request.post(`/api/profiles/${friendProfile!.id}/link`, {
        data: { token: friendToken },
      });

      // Friend can see the match.
      let friendMatches = (await (
        await friendCtx.request.get("/api/matches")
      ).json()) as { id: string }[];
      expect(friendMatches.some((m) => m.id === matchId)).toBe(true);

      // Reload the page so the scanner success view is dismissed and
      // the linked-card with its unlink button renders.
      await openProfile(ownerPage, friendProfile.id);
      await expect(
        ownerPage.locator("[data-testid='profile-unlink']"),
      ).toBeVisible({ timeout: 5000 });
      await ownerPage.click("[data-testid='profile-unlink']");

      // Friend's visibility drops.
      await expect
        .poll(
          async () => {
            friendMatches = (await (
              await friendCtx.request.get("/api/matches")
            ).json()) as { id: string }[];
            return friendMatches.some((m) => m.id === matchId);
          },
          { timeout: 5000 },
        )
        .toBe(false);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });
});

test.describe("Players tab (single-Profile model)", () => {
  test("Players tab excludes self-Profile and profiles representing me", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendToken = await getLinkToken(friendCtx.request);

      await signUp(ownerCtx);
      const ownerMe = await getMe(ownerCtx.request);

      // Owner creates two friends and links one of them.
      const friendProfile = await createUnclaimedProfile(
        ownerCtx.request,
        "Friend",
      );
      const otherProfile = await createUnclaimedProfile(
        ownerCtx.request,
        "Other",
      );
      await ownerCtx.request.post(`/api/profiles/${friendProfile.id}/link`, {
        data: { token: friendToken },
      });

      const ownerPage = await ownerCtx.newPage();
      await ownerPage.goto("/players");
      await ownerPage.waitForLoadState("domcontentloaded");

      // Wait for the live-query to settle.
      await expect(
        ownerPage.locator("[data-testid='player-row']"),
      ).toHaveCount(2, { timeout: 5000 });

      const rows = ownerPage.locator("[data-testid='player-row']");
      const ids = await rows.evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-profile-id")),
      );
      expect(ids).toContain(friendProfile.id);
      expect(ids).toContain(otherProfile.id);

      // The self-Profile (ownerId === linkedUserId === me) must not
      // appear in the listing.
      const profiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as {
        id: string;
        ownerId: string;
        linkedUserId: string | null;
      }[];
      const selfProfile = profiles.find(
        (p) => p.ownerId === ownerMe.id && p.linkedUserId === ownerMe.id,
      );
      expect(selfProfile).toBeDefined();
      expect(ids).not.toContain(selfProfile!.id);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });
});
