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
  /** Profile that survives. Its alias replaces any references that
   * pointed at `sourceProfileId`. */
  targetProfileId: string;
  /** Profile being absorbed. Disappears at the end of the transaction. */
  sourceProfileId: string;
};

/**
 * Collapse `source` into `target`: rewrite every `Player.profileId` and
 * every `ProfileGroupMember.profileId` from source → target, snapshot
 * `Player.name` to the target's alias so older clients that still read
 * the dormant column see the canonical display name, then delete the
 * source profile.
 *
 * This unclaimed-only variant rejects when either profile has a
 * `linkedUserId` set — the token-required path ships in PR 6-C. The
 * caller must own both profiles. All checks live inside the
 * transaction so two concurrent merges can't observe an intermediate
 * state.
 *
 * Returns the surviving (target) profile id so the caller can refetch
 * the canonical row.
 */
export async function mergeUnclaimedProfiles(
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
      select: { id: true, alias: true, ownerId: true, linkedUserId: true },
    }),
    tx.profile.findUnique({
      where: { id: sourceProfileId },
      select: { id: true, ownerId: true, linkedUserId: true },
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
  if (target.linkedUserId !== null || source.linkedUserId !== null) {
    // 6-C will introduce a token-checked path for linked merges; until
    // then a linked profile is locked.
    throw new ProfileMergeError(
      "Linked profiles cannot be merged via this endpoint",
      409,
    );
  }

  await tx.player.updateMany({
    where: { profileId: sourceProfileId },
    data: {
      profileId: targetProfileId,
      // Snapshot the surviving alias so the legacy `Player.name`
      // column stays coherent with `Player.profileId` for the soak
      // window before 6-E drops it.
      name: target.alias,
    },
  });

  // ProfileGroupMember stays empty until 6-D, but rewrite defensively
  // so the same merge call works for both today and after 6-D ships.
  // The compound unique [groupId, profileId] could collide if the
  // target is already a member of a group the source is in — delete
  // the source-side duplicates first.
  const sourceMemberships = await tx.profileGroupMember.findMany({
    where: { profileId: sourceProfileId },
    select: { groupId: true },
  });
  if (sourceMemberships.length > 0) {
    const groupIds = sourceMemberships.map((m) => m.groupId);
    const targetExisting = await tx.profileGroupMember.findMany({
      where: { profileId: targetProfileId, groupId: { in: groupIds } },
      select: { groupId: true },
    });
    const overlappingGroupIds = new Set(targetExisting.map((m) => m.groupId));
    if (overlappingGroupIds.size > 0) {
      await tx.profileGroupMember.deleteMany({
        where: {
          profileId: sourceProfileId,
          groupId: { in: [...overlappingGroupIds] },
        },
      });
    }
    await tx.profileGroupMember.updateMany({
      where: { profileId: sourceProfileId },
      data: { profileId: targetProfileId },
    });
  }

  await tx.profile.delete({ where: { id: sourceProfileId } });

  return targetProfileId;
}
