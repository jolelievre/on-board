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
 * Fold any of the owner's unclaimed profiles whose alias matches a
 * known label for the friend (the just-linked profile's alias, or
 * the friend's User name/alias) into the linked profile. Called
 * after a successful link so the user's pre-link "Bob" / "Mom" /
 * etc. profiles — created by typing the friend's name during past
 * matches — fold into the linked one. Without this, those past
 * matches keep referencing unclaimed profiles whose `linkedUserId`
 * is null, so the friend's visibility filter never picks them up.
 *
 * Case-insensitive exact alias match only — a fuzzy match would
 * sweep up genuinely-different friends who happen to share part of
 * a name. Even with the exact match a user with two unrelated
 * friends named "Bob" would see both folded into the linked one,
 * but: (a) that's the meaning of identical aliases, and (b) they
 * can always re-create the second "Bob" by typing it in a future
 * match.
 *
 * The merge uses the standard `mergeUnclaimedProfiles` helper with
 * `allowLinkedUserId` set to the friend so the linked target
 * passes the "target unclaimed OR linked to verified user" check.
 */
export async function autoFoldUnclaimedDuplicates(
  tx: TxClient,
  pair: {
    ownerUserId: string;
    friendUserId: string;
    linkedProfileId: string;
  },
): Promise<void> {
  // Cyclical import-style would be unavoidable if we imported the
  // merge helper at module top; calling it inline via a dynamic
  // import keeps the layering clean.
  const { mergeUnclaimedProfiles } = await import("./profile-merge.js");

  const linked = await tx.profile.findUnique({
    where: { id: pair.linkedProfileId },
    select: { id: true, alias: true },
  });
  const friend = await tx.user.findUnique({
    where: { id: pair.friendUserId },
    select: { name: true, alias: true },
  });
  if (!linked || !friend) return;

  // Build the set of aliases that should resolve to this friend:
  // the linked profile's own display name, the friend's User name,
  // and (if set) the friend's User alias. Lowercased for the
  // case-insensitive match.
  const targets = new Set<string>();
  for (const raw of [linked.alias, friend.name, friend.alias]) {
    const trimmed = raw?.trim().toLowerCase();
    if (trimmed) targets.add(trimmed);
  }
  if (targets.size === 0) return;

  const candidates = await tx.profile.findMany({
    where: {
      ownerId: pair.ownerUserId,
      linkedUserId: null,
      NOT: { id: pair.linkedProfileId },
    },
    select: { id: true, alias: true },
  });

  for (const c of candidates) {
    if (!targets.has(c.alias.trim().toLowerCase())) continue;
    try {
      await mergeUnclaimedProfiles(tx, {
        callerId: pair.ownerUserId,
        targetProfileId: pair.linkedProfileId,
        sourceProfileId: c.id,
        allowLinkedUserId: pair.friendUserId,
      });
    } catch {
      // Best-effort: if any single auto-merge raises (e.g. a race
      // with a concurrent merge already in flight), skip it and
      // keep going. The user can always merge manually from the
      // standalone MergeDialog afterwards.
    }
  }
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
): Promise<{ reverseProfileId: string } | null> {
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
  if (!owner || !friend) return null;

  // Friend's account → reverse profile representing the owner.
  // The friend hasn't acted yet, so don't clobber whatever profile
  // (if any) they already have for the owner.
  const reverse = await tx.profile.upsert({
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
    select: { id: true },
  });
  return { reverseProfileId: reverse.id };
}
