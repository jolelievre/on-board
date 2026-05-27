import { prisma } from "./prisma.js";
import { resolveSelfAlias } from "../../shared/players.js";

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

