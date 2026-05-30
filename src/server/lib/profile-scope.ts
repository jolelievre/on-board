import type { Prisma } from "@prisma/client";

/**
 * Canonical visibility predicate for `Match` rows. A match is visible
 * to a user when they either:
 *   - created it (`Match.createdById = me`), or
 *   - participate via a Profile that they own or are linked to
 *     (joined through Match.players → Player.profile).
 *
 * Both halves are needed because the creator's self-Profile may not
 * match the second half cleanly across all data shapes, and matches
 * still belong to the creator regardless of profile state.
 *
 * Centralized here so every endpoint that lists or fetches matches
 * uses the same rule. Without this, GET /matches and GET /matches/:id
 * could drift, and a regression would mean "I created the match but
 * I can't see it after the next pull-sync" or vice-versa.
 */
export function matchVisibilityWhere(userId: string): Prisma.MatchWhereInput {
  return {
    OR: [
      { createdById: userId },
      {
        players: {
          some: {
            profile: {
              OR: [{ ownerId: userId }, { linkedUserId: userId }],
            },
          },
        },
      },
    ],
  };
}
