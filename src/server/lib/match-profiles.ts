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
): Promise<string> {
  const trimmed = playerName.trim();
  const now = new Date();

  // Path 1: self-Profile.
  if (playerUserId && playerUserId === creatorId) {
    let self = await tx.profile.findUnique({
      where: { linkedUserId: creatorId },
      select: { id: true },
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
        select: { id: true },
      });
    } else {
      await tx.profile.update({
        where: { id: self.id },
        data: { usedAt: now },
      });
    }
    return self.id;
  }

  // Path 2: unclaimed alias match.
  const candidates = await tx.profile.findMany({
    where: {
      ownerId: creatorId,
      linkedUserId: null,
    },
    select: { id: true, alias: true },
  });
  const target = trimmed.toLowerCase();
  const hit = candidates.find((p) => p.alias.trim().toLowerCase() === target);
  if (hit) {
    await tx.profile.update({
      where: { id: hit.id },
      data: { usedAt: now },
    });
    return hit.id;
  }

  // Path 3: create.
  const created = await tx.profile.create({
    data: {
      ownerId: creatorId,
      alias: trimmed,
      usedAt: now,
    },
    select: { id: true },
  });
  return created.id;
}
