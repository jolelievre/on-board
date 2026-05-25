import type { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

type ResolveInput = {
  /** The User creating the match (and therefore the owner of any
   * Profile that gets created on the fly). */
  creatorId: string;
  /** Display name supplied by the client (the legacy input mode). */
  playerName: string;
  /** Legacy "self-detection" id: clients used to pass `userId === user.id`
   * when the player was the creator themselves. Still respected because
   * older clients in the wild keep sending it. */
  playerUserId: string | null;
};

type ResolveByProfileInput = {
  creatorId: string;
  profileId: string;
};

type ProfileResolution = {
  profileId: string;
  /** Snapshot of `Profile.alias` at resolution time — written to the
   * legacy `Player.name` column so older clients that still read it (and
   * the dormant column itself, until 6-E) stay coherent. */
  alias: string;
};

/**
 * Resolve a Player payload to a Profile id, creating an unclaimed
 * Profile owned by the creator if necessary. Used by `POST /api/matches`
 * so every Player row gets a `profileId` alongside the legacy `name` /
 * `userId` fields.
 *
 * Resolution order:
 *   1. **Self path** — when `playerUserId === creatorId`, return the
 *      creator's self-Profile (always pre-provisioned by the auth hook).
 *      If somehow missing on a legacy account, create it on demand.
 *   2. **Unclaimed alias match** — find a Profile owned by the creator
 *      whose alias matches `playerName` case-insensitively *and* whose
 *      `linkedUserId` is null. Linked profiles are excluded to avoid
 *      mis-attaching a friend who happens to share an alias the creator
 *      already gave to someone else.
 *   3. **Create** — make a new unclaimed Profile owned by the creator.
 *
 * Whichever path wins, bump `usedAt` so the most-recently-used profiles
 * float to the top of the suggestion list.
 */
export async function resolvePlayerProfileId(
  tx: TxClient,
  { creatorId, playerName, playerUserId }: ResolveInput,
): Promise<ProfileResolution> {
  const trimmed = playerName.trim();
  const now = new Date();

  // Path 1: self-Profile.
  if (playerUserId && playerUserId === creatorId) {
    let self = await tx.profile.findUnique({
      // The self-Profile has ownerId === linkedUserId === creatorId.
      // After 6-C scoped `linkedUserId` uniqueness to (ownerId,
      // linkedUserId), the composite is the right lookup key.
      where: {
        ownerId_linkedUserId: {
          ownerId: creatorId,
          linkedUserId: creatorId,
        },
      },
      select: { id: true, alias: true },
    });
    if (!self) {
      // Legacy account that pre-dates the auth hook. Pull the creator's
      // name from the User row to seed the alias.
      const user = await tx.user.findUnique({
        where: { id: creatorId },
        select: { name: true, alias: true },
      });
      const alias =
        user?.alias?.trim() || user?.name?.trim() || trimmed || "Me";
      self = await tx.profile.create({
        data: {
          ownerId: creatorId,
          linkedUserId: creatorId,
          alias,
        },
        select: { id: true, alias: true },
      });
    } else {
      await tx.profile.update({
        where: { id: self.id },
        data: { usedAt: now },
      });
    }
    return { profileId: self.id, alias: self.alias };
  }

  // Path 2: alias match against every profile owned by the creator
  // — including linked ones. Excluding linked profiles (the 6-A
  // behaviour) meant that typing a friend's name on the new-match
  // form would silently create a parallel unclaimed profile next
  // to the bilateral reverse profile created by `/api/profiles/:id/link`,
  // splitting the friend's match history across two rows. Folding
  // linked profiles into the candidate set lets the typed-name
  // path resolve to the linked friend's profile when there is one,
  // which is the only sensible interpretation of "type the same
  // alias you see in your friends list".
  const candidates = await tx.profile.findMany({
    where: { ownerId: creatorId },
    select: { id: true, alias: true },
  });
  const target = trimmed.toLowerCase();
  const hit = candidates.find((p) => p.alias.trim().toLowerCase() === target);
  if (hit) {
    await tx.profile.update({
      where: { id: hit.id },
      data: { usedAt: now },
    });
    return { profileId: hit.id, alias: hit.alias };
  }

  // Path 3: create.
  const created = await tx.profile.create({
    data: {
      ownerId: creatorId,
      alias: trimmed,
      usedAt: now,
    },
    select: { id: true, alias: true },
  });
  return { profileId: created.id, alias: created.alias };
}

/**
 * Resolve a Player payload that references a Profile by id (the 6-B
 * input mode). Verifies the caller is allowed to see the profile (owner
 * or linked) and bumps `usedAt` so the suggestion list stays fresh.
 *
 * Returns the canonical `alias` so the legacy `Player.name` column can
 * snapshot it — keeping the dormant field coherent until 6-E drops it.
 *
 * Throws if the profile doesn't exist or the caller isn't allowed to
 * use it; the matches route translates that into a 4xx response.
 */
export async function resolvePlayerByProfileId(
  tx: TxClient,
  { creatorId, profileId }: ResolveByProfileInput,
): Promise<ProfileResolution> {
  const profile = await tx.profile.findUnique({
    where: { id: profileId },
    select: { id: true, alias: true, ownerId: true, linkedUserId: true },
  });
  if (!profile) {
    throw new ProfileAuthorizationError("Profile not found", 404);
  }
  if (profile.ownerId !== creatorId && profile.linkedUserId !== creatorId) {
    throw new ProfileAuthorizationError(
      "Profile is not visible to this user",
      403,
    );
  }
  await tx.profile.update({
    where: { id: profile.id },
    data: { usedAt: new Date() },
  });
  return { profileId: profile.id, alias: profile.alias };
}

export class ProfileAuthorizationError extends Error {
  status: 403 | 404;
  constructor(message: string, status: 403 | 404) {
    super(message);
    this.name = "ProfileAuthorizationError";
    this.status = status;
  }
}
