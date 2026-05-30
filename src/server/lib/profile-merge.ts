import type { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

export class ProfileMergeError extends Error {
  status: 400 | 403 | 404 | 409;
  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = "ProfileMergeError";
    this.status = status;
  }
}

type MergeInput = {
  /** The User performing the merge — must own both profiles. */
  callerId: string;
  /** Profile that survives. Players from `source` move onto this row. */
  targetProfileId: string;
  /** Profile being absorbed. Disappears at the end of the transaction. */
  sourceProfileId: string;
};

/**
 * Collapse `source` into `target`: rewrite every `Player.profileId` from
 * source → target, carry the source's `linkedUserId` forward when the
 * target lacks one, copy `customAvatarUrl` only when the target has
 * none, then delete the source profile.
 *
 * Constraints (post single-Profile refactor):
 * - Caller must own both profiles. A merge is always an owner-side
 *   consolidation of two profiles representing the same person.
 * - If both profiles have `linkedUserId`, they must point at the same
 *   User. The composite `@@unique([ownerId, linkedUserId])` on Profile
 *   normally prevents the conflicting case, but we defend explicitly
 *   in case the constraint is ever relaxed.
 * - If only the source has `linkedUserId`, it transfers to the target
 *   before deletion. This is the merge-required collision path: the
 *   owner has an existing linked profile (target) and tries to link
 *   another (source) to the same friend; merging carries the freshly
 *   established link onto the survivor.
 *
 * All checks live inside the transaction so two concurrent merges
 * cannot observe an intermediate state.
 *
 * Returns the surviving profile id so the caller can refetch.
 */
export async function mergeProfiles(
  tx: TxClient,
  { callerId, targetProfileId, sourceProfileId }: MergeInput,
): Promise<string> {
  if (targetProfileId === sourceProfileId) {
    throw new ProfileMergeError(
      "Source and target must be different profiles",
      400,
    );
  }

  const [target, source] = await Promise.all([
    tx.profile.findUnique({
      where: { id: targetProfileId },
      select: {
        id: true,
        ownerId: true,
        linkedUserId: true,
        customAvatarUrl: true,
      },
    }),
    tx.profile.findUnique({
      where: { id: sourceProfileId },
      select: {
        id: true,
        ownerId: true,
        linkedUserId: true,
        customAvatarUrl: true,
      },
    }),
  ]);

  if (!target || !source) {
    throw new ProfileMergeError("Profile not found", 404);
  }
  if (target.ownerId !== callerId || source.ownerId !== callerId) {
    throw new ProfileMergeError(
      "You can only merge profiles you own",
      403,
    );
  }
  if (
    target.linkedUserId !== null &&
    source.linkedUserId !== null &&
    target.linkedUserId !== source.linkedUserId
  ) {
    throw new ProfileMergeError(
      "Cannot merge profiles linked to different accounts",
      409,
    );
  }

  await tx.player.updateMany({
    where: { profileId: sourceProfileId },
    data: { profileId: targetProfileId },
  });

  // Clear source.linkedUserId BEFORE updating target with the same
  // value, otherwise the `@@unique([ownerId, linkedUserId])` constraint
  // briefly fails (two rows owned by the caller pointing at the same
  // friend). The source row is about to be deleted anyway.
  if (source.linkedUserId !== null && target.linkedUserId === null) {
    await tx.profile.update({
      where: { id: sourceProfileId },
      data: { linkedUserId: null },
    });
  }

  // Carry the source's link forward when the target has none.
  const targetUpdates: Prisma.ProfileUpdateInput = {};
  if (target.linkedUserId === null && source.linkedUserId !== null) {
    targetUpdates.linkedUser = { connect: { id: source.linkedUserId } };
  }
  if (!target.customAvatarUrl && source.customAvatarUrl) {
    targetUpdates.customAvatarUrl = source.customAvatarUrl;
  }
  if (Object.keys(targetUpdates).length > 0) {
    await tx.profile.update({
      where: { id: targetProfileId },
      data: targetUpdates,
    });
  }

  await tx.profile.delete({ where: { id: sourceProfileId } });

  return targetProfileId;
}
