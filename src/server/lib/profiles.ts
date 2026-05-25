import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { resolveSelfAlias } from "../../shared/players.js";

type TxClient = Prisma.TransactionClient;

/**
 * Idempotently provision the self-Profile for a User.
 *
 * Called from the better-auth `user.create.after` hook so every newly
 * authenticated user immediately has a Profile representing themselves.
 * Safe to call repeatedly: the underlying upsert keys on `linkedUserId`,
 * which is unique. Used by the auth hook today; reusable by the
 * `/api/profiles` GET endpoint as a defensive top-up if a legacy user
 * somehow lacks their self-Profile.
 */
export async function ensureSelfProfile(user: {
  id: string;
  name: string;
  alias: string | null;
}): Promise<void> {
  const alias = resolveSelfAlias(user);
  await prisma.profile.upsert({
    // 6-C scoped `linkedUserId` uniqueness to (ownerId, linkedUserId),
    // so the self-profile lookup keys on the composite — same row
    // since `ownerId === linkedUserId === user.id` for a self-Profile.
    where: { ownerId_linkedUserId: { ownerId: user.id, linkedUserId: user.id } },
    create: {
      ownerId: user.id,
      linkedUserId: user.id,
      alias,
    },
    // The hook fires *after* user creation, so the alias on the User row
    // is the freshest value at this moment. We don't overwrite the
    // Profile's alias on subsequent calls — owner edits to Profile.alias
    // are independent of User.alias once the Profile exists.
    update: {},
  });
}

/**
 * Keep the self-Profile's `alias` in sync with `User.alias` whenever the
 * latter changes via Settings → updateUser. Without this mirror, the
 * Profile.alias the rest of the app reads as the canonical display name
 * would drift away from what the user just typed in Settings, and the
 * retroactive-alias-in-history flow would silently regress.
 *
 * Called from the better-auth `user.update.after` hook. Targets only
 * the *self* Profile (ownerId === linkedUserId === userId); profiles
 * linked from a friend's account aren't touched — that owner controls
 * the display alias independently.
 */
export async function syncSelfProfileAlias(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, alias: true },
  });
  if (!user) return;
  const alias = resolveSelfAlias(user);
  await prisma.profile.updateMany({
    where: { ownerId: userId, linkedUserId: userId },
    data: { alias },
  });
}

/**
 * The visibility filter for Profiles: an authenticated user can see
 * profiles they own (`ownerId = me`) or profiles linked to their own
 * auth account (`linkedUserId = me`). Used by the list, detail, and
 * mutation endpoints, and by the `/api/matches` resolver when binding
 * a Player to an existing Profile.
 */
export function profileVisibilityWhere(userId: string): Prisma.ProfileWhereInput {
  return {
    OR: [{ ownerId: userId }, { linkedUserId: userId }],
  };
}

/**
 * Ensure that user `friendUserId` has a Profile in their own account
 * representing user `ownerUserId` (and vice-versa). Called from the
 * link and merge handlers so a successful link/merge always leaves
 * both users with a record of each other — the friendship is
 * symmetric from the user's perspective, even though storage is
 * per-owner.
 *
 * Idempotent thanks to the composite `@@unique([ownerId, linkedUserId])`.
 * The alias for a newly created reverse profile is the other user's
 * canonical display name (alias → name → "Me" fallback). We never
 * overwrite an existing reverse profile's alias — the owner of that
 * row may have chosen their own nickname.
 */
export async function ensureBilateralLink(
  tx: TxClient,
  pair: { ownerUserId: string; friendUserId: string },
): Promise<void> {
  const [owner, friend] = await Promise.all([
    tx.user.findUnique({
      where: { id: pair.ownerUserId },
      select: { name: true, alias: true },
    }),
    tx.user.findUnique({
      where: { id: pair.friendUserId },
      select: { name: true, alias: true },
    }),
  ]);
  if (!owner || !friend) return;

  // Friend's account → reverse profile representing the owner.
  // The friend hasn't acted yet, so don't clobber whatever profile
  // (if any) they already have for the owner.
  await tx.profile.upsert({
    where: {
      ownerId_linkedUserId: {
        ownerId: pair.friendUserId,
        linkedUserId: pair.ownerUserId,
      },
    },
    create: {
      ownerId: pair.friendUserId,
      linkedUserId: pair.ownerUserId,
      alias: resolveSelfAlias(owner),
    },
    update: {},
  });
}
