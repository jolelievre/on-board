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

async function getLinkToken(
  req: APIRequestContext,
  sourceProfileId: string,
): Promise<string> {
  const res = await req.post(
    `/api/profiles/${sourceProfileId}/link-token`,
  );
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

/**
 * Helper: poll the friend's profile list until a profile with the
 * given alias appears (created via the new-match form sync queue),
 * then return its id.
 */
async function awaitProfileWithAlias(
  ctx: BrowserContext,
  alias: string,
): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (
          await ctx.request.get("/api/profiles")
        ).json()) as { id: string; alias: string }[];
        id = list.find((p) => p.alias === alias)?.id;
        return id;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  return id!;
}

/**
 * End-to-end bilateral link from two browser contexts: friend mints a
 * QR for their source profile, owner scans into their target profile.
 * Returns once both sides have flipped to Linked.
 */
async function performBilateralLink(opts: {
  ownerPage: Page;
  friendCtx: BrowserContext;
  ownerTargetProfileId: string;
  friendSourceProfileId: string;
}) {
  const token = await getLinkToken(
    opts.friendCtx.request,
    opts.friendSourceProfileId,
  );
  await opts.ownerPage.click("[data-testid='profile-link-scan']");
  await submitTokenViaHook(opts.ownerPage, token);
  await expect(
    opts.ownerPage.locator("[data-testid='link-celebration']").first(),
  ).toBeVisible({ timeout: 5000 });
}

test.describe("Profile linking (bilateral)", () => {
  test("a bilateral scan flips both profiles to Linked simultaneously", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendMe = await getMe(friendCtx.request);
      const friendSource = await createUnclaimedProfile(
        friendCtx.request,
        "OwnerSide",
      );

      await signUp(ownerCtx);
      const ownerMe = await getMe(ownerCtx.request);
      const ownerTarget = await createUnclaimedProfile(
        ownerCtx.request,
        "Alice",
      );

      const ownerPage = await ownerCtx.newPage();
      await openProfile(ownerPage, ownerTarget.id);
      await performBilateralLink({
        ownerPage,
        friendCtx,
        ownerTargetProfileId: ownerTarget.id,
        friendSourceProfileId: friendSource.id,
      });

      // Scanner side: target now linked to friend.
      const ownerProfiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as { id: string; linkedUserId: string | null }[];
      expect(
        ownerProfiles.find((p) => p.id === ownerTarget.id)?.linkedUserId,
      ).toBe(friendMe.id);

      // Shower side: source now linked to owner — no auto-mirror
      // profile was created on the friend's side.
      const friendProfiles = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as { id: string; linkedUserId: string | null }[];
      expect(
        friendProfiles.find((p) => p.id === friendSource.id)?.linkedUserId,
      ).toBe(ownerMe.id);
      // Only self-Profile + the source we created — no mirror row.
      expect(friendProfiles.length).toBe(2);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("after linking, the friend can see prior matches the owner already created", async ({
    browser,
  }) => {
    // Assertion drives through the friend's browser at
    // /games/7-wonders-duel — the same surface a real user would
    // open. An API-only check would pass on the server contract
    // alone and miss any Dexie/visibility regression in the client.
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendSource = await createUnclaimedProfile(
        friendCtx.request,
        "OwnerSide",
      );

      await signUp(ownerCtx);
      const ownerPage = await ownerCtx.newPage();
      const matchId = await createMatchViaForm(ownerPage, {
        gameSlug: "7-wonders-duel",
        playerNames: ["Me", "Friend"],
      });
      const friendProfileId = await awaitProfileWithAlias(ownerCtx, "Friend");

      await openProfile(ownerPage, friendProfileId);
      await performBilateralLink({
        ownerPage,
        friendCtx,
        ownerTargetProfileId: friendProfileId,
        friendSourceProfileId: friendSource.id,
      });

      // Friend opens the 7 Wonders Duel page in their own browser and
      // expects to see the match in the history.
      const friendPage = await friendCtx.newPage();
      await friendPage.goto("/games/7-wonders-duel");
      await friendPage.waitForLoadState("domcontentloaded");
      await expect(
        friendPage.locator(`[data-testid='match-history-row-${matchId}']`),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("linking a profile does not hide its existing match history from the owner's UI", async ({
    browser,
  }) => {
    // Regression gate for the disappearing-matches bug. Pre-link, the
    // owner sees N matches under their friend's profile. After tapping
    // Scan QR and submitting the token, the same UI must still show
    // the same N matches. The bug was that `collectPersonPlayers`
    // switched its query branch from `profileId` to
    // `profileLinkedUserId` when `linkedUserId` flipped, but the local
    // Player rows still had a stale `profileLinkedUserId: null` denorm.
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendSource = await createUnclaimedProfile(
        friendCtx.request,
        "OwnerSide",
      );

      await signUp(ownerCtx);
      const ownerPage = await ownerCtx.newPage();
      const match1 = await createMatchViaForm(ownerPage, {
        gameSlug: "7-wonders-duel",
        playerNames: ["Me", "Friend"],
      });
      const match2 = await createMatchViaForm(ownerPage, {
        gameSlug: "7-wonders-duel",
        playerNames: ["Me", "Friend"],
      });
      expect(match1).not.toBe(match2);

      const friendProfileId = await awaitProfileWithAlias(ownerCtx, "Friend");

      // Pre-link: profile detail UI shows both matches.
      await openProfile(ownerPage, friendProfileId);
      await expect(
        ownerPage.locator("[data-testid='profile-recent-match']"),
      ).toHaveCount(2, { timeout: 10_000 });

      await performBilateralLink({
        ownerPage,
        friendCtx,
        ownerTargetProfileId: friendProfileId,
        friendSourceProfileId: friendSource.id,
      });

      // Re-open the profile so the scanner success view collapses
      // into the Linked card. The recent matches must still be there.
      await openProfile(ownerPage, friendProfileId);
      await expect(
        ownerPage.locator("[data-testid='profile-unlink']"),
      ).toBeVisible({ timeout: 5000 });
      await expect(
        ownerPage.locator("[data-testid='profile-recent-match']"),
      ).toHaveCount(2);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("Unlink confirm modal cites the friend's name and Cancel keeps the link intact", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendMe = await getMe(friendCtx.request);
      const friendSource = await createUnclaimedProfile(
        friendCtx.request,
        "OwnerSide",
      );

      await signUp(ownerCtx);
      const ownerPage = await ownerCtx.newPage();
      const target = await createUnclaimedProfile(ownerCtx.request, "Alice");
      await openProfile(ownerPage, target.id);
      await performBilateralLink({
        ownerPage,
        friendCtx,
        ownerTargetProfileId: target.id,
        friendSourceProfileId: friendSource.id,
      });
      await openProfile(ownerPage, target.id);
      await expect(
        ownerPage.locator("[data-testid='profile-unlink']"),
      ).toBeVisible({ timeout: 5000 });

      // Open the confirm modal; the body should reference the
      // friend's name so the user understands the bilateral effect.
      await ownerPage.click("[data-testid='profile-unlink']");
      const dialog = ownerPage.locator("[data-testid='unlink-dialog']");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(friendMe.name);

      // Cancel keeps both sides linked.
      await ownerPage.click("[data-testid='unlink-cancel']");
      await expect(dialog).not.toBeVisible();

      const ownerProfiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as { id: string; linkedUserId: string | null }[];
      expect(
        ownerProfiles.find((p) => p.id === target.id)?.linkedUserId,
      ).toBe(friendMe.id);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("Confirming Unlink bilaterally severs both sides and prunes cross-user match visibility", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendSource = await createUnclaimedProfile(
        friendCtx.request,
        "OwnerSide",
      );

      await signUp(ownerCtx);
      const ownerPage = await ownerCtx.newPage();
      const matchId = await createMatchViaForm(ownerPage, {
        gameSlug: "7-wonders-duel",
        playerNames: ["Me", "Friend"],
      });
      const friendProfileId = await awaitProfileWithAlias(ownerCtx, "Friend");
      await openProfile(ownerPage, friendProfileId);
      await performBilateralLink({
        ownerPage,
        friendCtx,
        ownerTargetProfileId: friendProfileId,
        friendSourceProfileId: friendSource.id,
      });

      // Friend's UI shows the match while linked.
      const friendPage = await friendCtx.newPage();
      await friendPage.goto("/games/7-wonders-duel");
      await friendPage.waitForLoadState("domcontentloaded");
      await expect(
        friendPage.locator(`[data-testid='match-history-row-${matchId}']`),
      ).toBeVisible({ timeout: 10_000 });

      // Owner unlinks (with explicit confirm).
      await openProfile(ownerPage, friendProfileId);
      await ownerPage.click("[data-testid='profile-unlink']");
      await ownerPage.click("[data-testid='unlink-confirm']");
      await expect(
        ownerPage.locator("[data-testid='profile-link-scan']"),
      ).toBeVisible({ timeout: 5000 });

      // Both sides now show the profile as unclaimed.
      const ownerProfiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as { id: string; linkedUserId: string | null }[];
      expect(
        ownerProfiles.find((p) => p.id === friendProfileId)?.linkedUserId,
      ).toBeNull();
      const friendProfiles = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as { id: string; linkedUserId: string | null }[];
      expect(
        friendProfiles.find((p) => p.id === friendSource.id)?.linkedUserId,
      ).toBeNull();

      // Friend's UI no longer surfaces the owner-created match.
      await friendPage.reload();
      await friendPage.waitForLoadState("domcontentloaded");
      await expect(
        friendPage.locator(`[data-testid='match-history-row-${matchId}']`),
      ).toHaveCount(0, { timeout: 10_000 });

      // Owner's own past matches remain on their side under the
      // now-unclaimed profile.
      await openProfile(ownerPage, friendProfileId);
      await expect(
        ownerPage.locator("[data-testid='profile-recent-match']"),
      ).toHaveCount(1, { timeout: 10_000 });
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("After bilateral linking, EACH side sees the OTHER's pre-link matches in their UI (established pull cursors)", async ({
    browser,
  }) => {
    // The user-reported bug: both sides have established pull-sync
    // cursors (i.e. they've used the app before), each side has
    // created matches with their own unclaimed "friend" profile, then
    // they bilaterally link. The cross-user pre-link history must
    // become visible in both UIs. A `?since=` delta would miss those
    // matches because the link doesn't bump Match.updatedAt; the link
    // mutation has to reset both cursors and force a full re-pull.
    //
    // To simulate established cursors, each side opens the app UI
    // *before* the link (which triggers a boot-time pullSync that
    // stamps the cursor). Then we perform the bilateral link and
    // assert each side sees the other's pre-link match via the UI
    // (the recent-matches list on the linked profile detail page,
    // and the per-game match-history).
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const userA = await signUp(ctxA);
      const userB = await signUp(ctxB);

      // Each side creates a match with their OWN self-profile (the
      // form's exact-alias match resolves to the auto-created
      // self-Profile when the signup name is typed) + an unclaimed
      // profile for the other person. Using the self-profile is what
      // makes the match attributable through bilateral linking —
      // `collectPersonPlayers` widens on `profileLinkedUserId`, and
      // the self-profile already has its owner's user id in that
      // column. A match with no self-seat doesn't carry the
      // identifying link.
      const pageA = await ctxA.newPage();
      const matchA = await createMatchViaForm(pageA, {
        gameSlug: "7-wonders-duel",
        playerNames: [userA.name, "Bob"],
      });
      const aProfileOfB = await awaitProfileWithAlias(ctxA, "Bob");

      const pageB = await ctxB.newPage();
      const matchB = await createMatchViaForm(pageB, {
        gameSlug: "7-wonders-duel",
        playerNames: [userB.name, "Alice"],
      });
      const bProfileOfA = await awaitProfileWithAlias(ctxB, "Alice");

      // Establish a recent pull cursor on both sides by navigating to
      // an authenticated route (the boot-time pullSync stamps
      // lastPullAt). Without this the link's full re-pull would be a
      // no-op for either side — the bug only manifests against an
      // established cursor.
      await pageA.goto("/players");
      await pageA.waitForLoadState("domcontentloaded");
      await expect(
        pageA.locator("[data-testid='player-row']"),
      ).toHaveCount(1, { timeout: 10_000 });
      await pageB.goto("/players");
      await pageB.waitForLoadState("domcontentloaded");
      await expect(
        pageB.locator("[data-testid='player-row']"),
      ).toHaveCount(1, { timeout: 10_000 });

      // Bilateral link: A scans B's QR on A's "Bob" profile.
      await openProfile(pageA, aProfileOfB);
      await performBilateralLink({
        ownerPage: pageA,
        friendCtx: ctxB,
        ownerTargetProfileId: aProfileOfB,
        friendSourceProfileId: bProfileOfA,
      });

      // A's side: open the linked "Bob" profile detail → A sees A's
      // own pre-link match AND B's pre-link match (visibility flows
      // through B.bProfileOfA.linkedUserId == A).
      await openProfile(pageA, aProfileOfB);
      await expect(
        pageA.locator("[data-testid='profile-recent-match']"),
      ).toHaveCount(2, { timeout: 10_000 });

      // A's per-game history confirms cross-user pull.
      await pageA.goto("/games/7-wonders-duel");
      await pageA.waitForLoadState("domcontentloaded");
      await expect(
        pageA.locator(`[data-testid='match-history-row-${matchA}']`),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        pageA.locator(`[data-testid='match-history-row-${matchB}']`),
      ).toBeVisible({ timeout: 10_000 });

      // Symmetric assertion on B's side. B has to trigger their own
      // pull-sync (their session has its own cursor); navigating to
      // an authenticated route refreshes it via the boot/route
      // pullSync trigger.
      await openProfile(pageB, bProfileOfA);
      await expect(
        pageB.locator("[data-testid='profile-recent-match']"),
      ).toHaveCount(2, { timeout: 10_000 });
      await pageB.goto("/games/7-wonders-duel");
      await pageB.waitForLoadState("domcontentloaded");
      await expect(
        pageB.locator(`[data-testid='match-history-row-${matchA}']`),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        pageB.locator(`[data-testid='match-history-row-${matchB}']`),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("Re-linking after an unlink restores bilateral visibility", async ({
    browser,
  }) => {
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendSource = await createUnclaimedProfile(
        friendCtx.request,
        "OwnerSide",
      );

      await signUp(ownerCtx);
      const ownerPage = await ownerCtx.newPage();
      const matchId = await createMatchViaForm(ownerPage, {
        gameSlug: "7-wonders-duel",
        playerNames: ["Me", "Friend"],
      });
      const friendProfileId = await awaitProfileWithAlias(ownerCtx, "Friend");
      await openProfile(ownerPage, friendProfileId);

      await performBilateralLink({
        ownerPage,
        friendCtx,
        ownerTargetProfileId: friendProfileId,
        friendSourceProfileId: friendSource.id,
      });

      // Unlink.
      await openProfile(ownerPage, friendProfileId);
      await ownerPage.click("[data-testid='profile-unlink']");
      await ownerPage.click("[data-testid='unlink-confirm']");
      await expect(
        ownerPage.locator("[data-testid='profile-link-scan']"),
      ).toBeVisible({ timeout: 5000 });

      // Re-link via a fresh QR.
      await performBilateralLink({
        ownerPage,
        friendCtx,
        ownerTargetProfileId: friendProfileId,
        friendSourceProfileId: friendSource.id,
      });

      // Friend regains full visibility of the owner-created match.
      const friendPage = await friendCtx.newPage();
      await friendPage.goto("/games/7-wonders-duel");
      await friendPage.waitForLoadState("domcontentloaded");
      await expect(
        friendPage.locator(`[data-testid='match-history-row-${matchId}']`),
      ).toBeVisible({ timeout: 10_000 });
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
      const friendSource = await createUnclaimedProfile(
        friendCtx.request,
        "OwnerSide",
      );
      const friendToken = await getLinkToken(
        friendCtx.request,
        friendSource.id,
      );

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
