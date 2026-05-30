import type { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

type ResolveByProfileInput = {
  creatorId: string;
  profileId: string;
};

type ProfileResolution = {
  profileId: string;
};

/**
 * Resolve a Player payload that references a Profile by id. Verifies
 * the caller is allowed to see the profile (owner or linked) and bumps
 * `usedAt` so the suggestion list stays fresh.
 *
 * Under the single-Profile model (post-6-C), this is the only resolver
 * the matches route uses. Every Player must carry a `profileId`; the
 * legacy name-based resolver was removed along with `Player.name` and
 * `Player.userId`.
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
    select: { id: true, ownerId: true, linkedUserId: true },
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
  return { profileId: profile.id };
}

export class ProfileAuthorizationError extends Error {
  status: 403 | 404;
  constructor(message: string, status: 403 | 404) {
    super(message);
    this.name = "ProfileAuthorizationError";
    this.status = status;
  }
}
