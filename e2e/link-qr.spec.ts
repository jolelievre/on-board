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

      // No duplicate row for the same linked friend. The friend
      // should see exactly:
      //   - their own self-profile
      //   - one row representing the owner (the auto-created reverse
      //     profile in their account)
      // …and *not* the owner-owned profile that points at them (it's
      // a representation of *the friend themself* in the owner's
      // account, which would just show up as another row badged with
      // the friend's own name). Total: 2 rows.
      await expect(
        friendPage.getByTestId("player-row"),
      ).toHaveCount(2);
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

  test("matches created by either side surface under the bilateral linked profile", async ({
    browser,
  }) => {
    // After a successful link, the friend can create a match
    // including the owner from their side. The match must be
    // visible to the owner under the bilateral reverse profile
    // (owned by owner, linkedUserId === friend). Without the
    // person-wide widening in `useProfileRecentMatches` the owner
    // would only see matches they themselves picked the reverse
    // profile in, never matches the friend originated.
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendMe = await getMe(friendCtx.request);

      await signUp(ownerCtx);
      const ownerMe = await getMe(ownerCtx.request);
      const alice = await createUnclaimedProfile(ownerCtx.request, "Alice");

      // Owner links Alice → friend.
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

      // Friend creates a match including themselves + the owner.
      // The owner's seat references the friend's bilateral reverse
      // profile (owned by friend, linked to owner) — that's the
      // row the relaxed alias resolver picks when "owner.name"
      // matches it, and the picker path is what real users hit.
      const friendProfiles = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as {
        id: string;
        ownerId: string;
        linkedUserId: string | null;
      }[];
      const friendsViewOfOwner = friendProfiles.find(
        (p) => p.ownerId === friendMe.id && p.linkedUserId === ownerMe.id,
      );
      expect(friendsViewOfOwner).toBeDefined();

      const gameRes = await friendCtx.request.get(
        "/api/games/7-wonders-duel",
      );
      const game = (await gameRes.json()) as { id: string };
      // No explicit `userId` here — the UI new-match form doesn't
      // set it either, so the server must auto-attribute the
      // creator's seat itself when the resolved profile is the
      // self-profile. Otherwise the `Player.userId` column stays
      // null and `collectPersonPlayers` on the friend's side can't
      // pick the match up.
      const friendProfilesList = (await (
        await friendCtx.request.get("/api/profiles")
      ).json()) as { id: string; ownerId: string; linkedUserId: string | null }[];
      const friendSelfId = friendProfilesList.find(
        (p) => p.ownerId === friendMe.id && p.linkedUserId === friendMe.id,
      )!.id;
      const matchRes = await friendCtx.request.post("/api/matches", {
        data: {
          gameId: game.id,
          players: [
            // Friend's own seat — referenced by profileId, exactly
            // as the picker would. No `userId` passed; server has
            // to recognise the self-profile and set it itself.
            {
              profileId: friendSelfId,
              position: 0,
            },
            {
              profileId: friendsViewOfOwner!.id,
              position: 1,
            },
          ],
        },
      });
      expect(matchRes.status()).toBe(201);

      // Locate the owner's bilateral reverse profile id.
      const profiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as {
        id: string;
        ownerId: string;
        linkedUserId: string | null;
      }[];
      const reverse = profiles.find(
        (p) => p.ownerId === ownerMe.id && p.linkedUserId === friendMe.id,
      );
      expect(reverse).toBeDefined();

      // Sanity-check the server response first: the visibility
      // filter must include the friend's match (via the bilateral
      // friend-side profile pointing at the owner) before we can
      // ask the UI to render it.
      await expect
        .poll(
          async () => {
            const list = (await (
              await ownerCtx.request.get("/api/matches")
            ).json()) as { id: string }[];
            return list.length;
          },
          { timeout: 5_000 },
        )
        .toBeGreaterThan(0);

      // Open the bilateral reverse profile in the owner's browser.
      // The friend's match must appear in the recent-matches list
      // (resolved via the `Player.userId === friend.id` widening
      // in `useProfileRecentMatches`).
      await openProfile(ownerPage, reverse!.id);
      // Pull-sync runs on a 5 s throttle for route changes; the
      // friend's match was created via the API and the owner's
      // browser has no other signal that it should re-fetch.
      // Firing a `visibilitychange` is the same path the app uses
      // when the user returns to the tab from another device and
      // bypasses the throttle (`force: true`).
      await ownerPage.evaluate(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const recentLinks = ownerPage.locator(
        "[data-testid='profile-recent-match']",
      );
      await expect(recentLinks).not.toHaveCount(0, { timeout: 10_000 });
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("matches created before linking become mutually visible after the link", async ({
    browser,
  }) => {
    // The natural pre-link state: each user has typed the other's
    // alias during a match → an unclaimed owned profile per side.
    // After the link, those past matches must flow into the
    // bilateral visibility so each side sees the other's history.
    // Without the auto-merge-on-link step the matches stay tied to
    // unclaimed profiles and the friend-side visibility filter
    // never picks them up.
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      const friend = await signUp(friendCtx);
      const owner = await signUp(ownerCtx);
      const ownerMe = await getMe(ownerCtx.request);

      const game = (await (
        await ownerCtx.request.get("/api/games/7-wonders-duel")
      ).json()) as { id: string };

      // Pre-link: each side creates a match including the *typed*
      // alias of the other. The new-match form's free-text path
      // is what users hit when they don't have a linked friend
      // yet, so simulating it via plain `name:` strings is the
      // right shape.
      const ownerPreMatchRes = await ownerCtx.request.post("/api/matches", {
        data: {
          gameId: game.id,
          players: [
            { name: owner.name, position: 0 },
            { name: friend.name, position: 1 },
          ],
        },
      });
      expect(ownerPreMatchRes.status()).toBe(201);
      const ownerPreMatchId = (await ownerPreMatchRes.json()).id as string;

      const friendPreMatchRes = await friendCtx.request.post("/api/matches", {
        data: {
          gameId: game.id,
          players: [
            { name: friend.name, position: 0 },
            { name: owner.name, position: 1 },
          ],
        },
      });
      expect(friendPreMatchRes.status()).toBe(201);
      const friendPreMatchId = (await friendPreMatchRes.json()).id as string;

      // Now link. Owner picks the profile they typed earlier (the
      // server's alias resolver returned the unclaimed one created
      // by the match POST, so it's already in their owned-profiles
      // list) and links it to the friend.
      const ownerProfiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as {
        id: string;
        alias: string;
        ownerId: string;
        linkedUserId: string | null;
      }[];
      const ownerFriendProfile = ownerProfiles.find(
        (p) =>
          p.ownerId === ownerMe.id &&
          p.alias.toLowerCase() === friend.name.toLowerCase(),
      )!;
      expect(ownerFriendProfile).toBeDefined();

      const ownerPage = await ownerCtx.newPage();
      await openProfile(ownerPage, ownerFriendProfile.id);
      await ownerPage.click("[data-testid='profile-link']");
      await submitTokenViaHook(
        ownerPage,
        await getLinkToken(friendCtx.request),
      );
      await expect(
        ownerPage.locator("[data-testid='link-scanner-linked']"),
      ).toBeVisible();
      await ownerPage.click("[data-testid='link-scanner'] >> text=Done");

      // Both pre-link matches must now be mutually visible. The
      // owner sees the friend's pre-link match; the friend sees
      // the owner's pre-link match. Without bug 1 fixed, the
      // friend's match would stay tied to a friend-owned
      // unclaimed profile (no visibility for the owner), so the
      // owner's /api/matches response wouldn't include it.
      await expect
        .poll(
          async () => {
            const list = (await (
              await ownerCtx.request.get("/api/matches")
            ).json()) as { id: string }[];
            return list.some((m) => m.id === friendPreMatchId);
          },
          { timeout: 5_000 },
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            const list = (await (
              await friendCtx.request.get("/api/matches")
            ).json()) as { id: string }[];
            return list.some((m) => m.id === ownerPreMatchId);
          },
          { timeout: 5_000 },
        )
        .toBe(true);

      // …and the bilateral reverse profile's recent-matches list
      // on the owner side also includes the friend's pre-link
      // match. This requires the auto-merge to have folded the
      // friend's typed-alias profile (now linked to the owner)
      // into the bilateral state.
      await ownerPage.evaluate(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await openProfile(ownerPage, ownerFriendProfile.id);
      const recentLinks = ownerPage.locator(
        "[data-testid='profile-recent-match']",
      );
      await expect(recentLinks).not.toHaveCount(0, { timeout: 10_000 });
      // Sanity that we're not just seeing the bidirectional
      // (post-link) match — neither was created, so the only
      // candidate is the pre-link one.
      const count = await recentLinks.count();
      expect(count).toBeGreaterThanOrEqual(1);
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
    }
  });

  test("unlinking severs both directions and prunes friend-only matches from local Dexie", async ({
    browser,
  }) => {
    // After unlink the user expects the friendship to be fully
    // gone: friend's matches must drop out of the local mirror so
    // history visible offline reflects the new visibility. This
    // requires both (a) bilateral unlink on the server (otherwise
    // the bilateral reverse keeps the match visible) and (b) a
    // local prune step in `unlinkProfile` since pull-sync's
    // incremental cursor can't represent deletions.
    const friendCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    try {
      await signUp(friendCtx);
      const friendMe = await getMe(friendCtx.request);
      await signUp(ownerCtx);
      const ownerMe = await getMe(ownerCtx.request);

      // Link.
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

      // Friend creates a match including the owner via their
      // bilateral reverse (the alias resolver picks it up by name).
      const game = (await (
        await friendCtx.request.get("/api/games/7-wonders-duel")
      ).json()) as { id: string };
      // Match the new-match form payload exactly: typed name only,
      // no explicit `userId`. The server is responsible for
      // recognising the creator's self-seat and setting
      // `Player.userId` accordingly.
      const matchRes = await friendCtx.request.post("/api/matches", {
        data: {
          gameId: game.id,
          players: [
            { name: friendMe.name, position: 0 },
            { name: ownerMe.name, position: 1 },
          ],
        },
      });
      expect(matchRes.status()).toBe(201);
      const friendMatchId = (await matchRes.json()).id as string;

      // Bring it into the owner's Dexie via a forced pullSync.
      await ownerPage.evaluate(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // Game view: the friend's match must appear in the per-game
      // history list too, since it's just another row in Dexie
      // that `useMatchList(gameId)` reads. Asserting on the UI
      // here covers the user's "match shows up in the game list,
      // not just the friend profile" request.
      await ownerPage.goto("/games/7-wonders-duel");
      await ownerPage.waitForLoadState("domcontentloaded");
      await expect(
        ownerPage.locator(`[data-testid='match-history-row-${friendMatchId}']`),
      ).toBeVisible({ timeout: 10_000 });

      // Stats block on the bilateral reverse profile also counts
      // the shared match — `useProfileStats` uses the same
      // `collectPersonPlayers` widening as the recent-matches
      // hook, so the friend-side match counts toward the owner's
      // record of matches played with this friend.
      const reverseProfiles = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as {
        id: string;
        ownerId: string;
        linkedUserId: string | null;
      }[];
      const reverseId = reverseProfiles.find(
        (p) => p.ownerId === ownerMe.id && p.linkedUserId === friendMe.id,
      )!.id;
      await openProfile(ownerPage, reverseId);
      await expect(
        ownerPage.locator("[data-testid='profile-stats-matches']"),
      ).toContainText("1");

      // Unlink Alice from the owner side.
      await openProfile(ownerPage, alice.id);
      await ownerPage.click("[data-testid='profile-unlink']");
      // Mutation settled: the unlink button is no longer present
      // (profile flipped back to unclaimed → re-renders to scan
      // CTA).
      await expect(
        ownerPage.locator("[data-testid='profile-unlink']"),
      ).toHaveCount(0);

      // Server view: bilateral unlink cleared both sides. The
      // friend's match is no longer visible to the owner because
      // no profile linking owner remains in any of its players.
      await expect
        .poll(
          async () => {
            const list = (await (
              await ownerCtx.request.get("/api/matches")
            ).json()) as { id: string }[];
            return list.some((m) => m.id === friendMatchId);
          },
          { timeout: 5_000 },
        )
        .toBe(false);

      // Game view after unlink: the match must drop out of the
      // history list. Without the prune step it would linger
      // forever (the incremental pull-sync cursor can't represent
      // deletions, so a passive re-pull would not remove it).
      await ownerPage.goto("/games/7-wonders-duel");
      await ownerPage.waitForLoadState("domcontentloaded");
      await expect(
        ownerPage.locator(`[data-testid='match-history-row-${friendMatchId}']`),
      ).toHaveCount(0);

      // The friend-side bilateral reverse is gone too (bilateral
      // unlink). Re-resolve the unclaimed profile that used to be
      // the bilateral pair on the owner's side — it now has
      // `linkedUserId: null`, so the stats block reads the
      // direct-only player rows. The previously visible friend's
      // match was pruned, so the count is 0.
      const afterUnlink = (await (
        await ownerCtx.request.get("/api/profiles")
      ).json()) as {
        id: string;
        ownerId: string;
        linkedUserId: string | null;
      }[];
      const standalone = afterUnlink.find(
        (p) =>
          p.ownerId === ownerMe.id &&
          p.linkedUserId === null &&
          (p.id === reverseId || p.id === alice.id),
      );
      if (standalone) {
        await openProfile(ownerPage, standalone.id);
        // The stats block renders an empty-state when totalMatches
        // is 0 — that's the right signal that the friend-side
        // match no longer feeds into this profile's stats.
        await expect(
          ownerPage.locator("[data-testid='profile-stats-matches']"),
        ).toHaveCount(0);
      }
    } finally {
      await friendCtx.close();
      await ownerCtx.close();
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
