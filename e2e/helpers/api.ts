import type { APIRequestContext, BrowserContext } from "@playwright/test";
import type { ApiMatch, ApiProfile } from "../../src/client/lib/api-types";
import { createAndSignIn } from "./auth";

/**
 * Shared fixture helpers for E2E specs. Lifted out of the individual
 * spec files so the same setup primitives (`createProfile`,
 * `mintLinkToken`, `createTestMatch`, …) live in one place — every
 * test reads the same shape and bug fixes / contract changes only
 * land in one source.
 */

/** Sign up + sign in tied to a `BrowserContext` (so the session
 * cookie sticks to that context for later UI navigation in the same
 * test). Thin wrapper around the API-level `createAndSignIn`. */
export function signUpContext(ctx: BrowserContext) {
  return createAndSignIn(ctx.request);
}

export async function createProfile(
  req: APIRequestContext,
  alias: string,
): Promise<ApiProfile> {
  const res = await req.post("/api/profiles", { data: { alias } });
  if (!res.ok()) {
    throw new Error(
      `createProfile(${alias}) -> ${res.status()} ${await res.text()}`,
    );
  }
  return (await res.json()) as ApiProfile;
}

export async function mintLinkToken(
  req: APIRequestContext,
  sourceProfileId: string,
): Promise<string> {
  const res = await req.post(`/api/profiles/${sourceProfileId}/link-token`);
  if (!res.ok()) {
    throw new Error(
      `mintLinkToken(${sourceProfileId}) -> ${res.status()} ${await res.text()}`,
    );
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}

export async function getMe(
  req: APIRequestContext,
): Promise<{ id: string; name: string; email: string }> {
  const res = await req.get("/api/auth/get-session");
  const body = await res.json();
  return body.user;
}

export type CreateTestMatchOptions = {
  /** Defaults to "7-wonders-duel". */
  gameSlug?: string;
  /** Aliases for the players, in seat order. Defaults to ["Alice", "Bob"].
   * Each alias becomes a freshly-created unclaimed profile. */
  aliases?: string[];
};

/**
 * Create a match end-to-end via the API: a fresh unclaimed profile
 * per player, then `POST /api/matches`. Returns the created match
 * (the full ApiMatch shape so callers can read the persisted Player
 * ids for score POSTs).
 */
export async function createTestMatch(
  req: APIRequestContext,
  opts: CreateTestMatchOptions = {},
): Promise<ApiMatch> {
  const gameSlug = opts.gameSlug ?? "7-wonders-duel";
  const aliases = opts.aliases ?? ["Alice", "Bob"];

  const gameRes = await req.get(`/api/games/${gameSlug}`);
  const game = (await gameRes.json()) as { id: string };

  const profiles: ApiProfile[] = [];
  for (const alias of aliases) {
    profiles.push(await createProfile(req, alias));
  }

  const res = await req.post("/api/matches", {
    data: {
      gameId: game.id,
      players: profiles.map((p, i) => ({
        profileId: p.id,
        position: i,
      })),
    },
  });
  if (!res.ok()) {
    throw new Error(`createTestMatch -> ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as ApiMatch;
}
