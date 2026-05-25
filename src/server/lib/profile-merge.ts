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
  /**
   * Optional verified User id whose `linkedUserId` is permitted on
   * either profile. PR 6-C's link flow passes the friend's id here
   * after verifying their HMAC token; without it, linked profiles are
   * rejected. Both profiles must still be owned by `callerId`.
   */
  allowLinkedUserId?: string;
};

/**
 * Collapse `source` into `target`: rewrite every `Player.profileId` and
 * every `ProfileGroupMember.profileId` from source → target, snapshot
 * `Player.name` to the target's alias so older clients that still read
 * the dormant column see the canonical display name, copy the source's
 * `customAvatarUrl` onto the target only when the target has no custom
 * avatar of its own, then delete the source profile.
 *
 * Variants:
 * - **Unclaimed** (default): both profiles must have `linkedUserId == null`.
 *   Used by the standalone merge action shipped in PR 6-B.
 * - **Linked**: `allowLinkedUserId` matches the friend's User id (the
 *   caller proved this with an HMAC token at the route layer). Used by
 *   the link-time merge collision branch shipped in PR 6-C.
 *
 * The caller must own both profiles. All checks live inside the
 * transaction so two concurrent merges can't observe an intermediate
 * state.
 *
 * Returns the surviving (target) profile id so the caller can refetch
 * the canonical row.
 */
export async function mergeUnclaimedProfiles(
  tx: TxClient,
  {
    callerId,
    targetProfileId,
    sourceProfileId,
    allowLinkedUserId,
  }: MergeInput,
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
        alias: true,
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
  // Allowed merge shapes (both profiles already verified to be owned
  // by the caller above):
  //
  //   1. Both unclaimed → trivial. (6-B baseline.)
  //   2. Target linked, source unclaimed → preserve target's link.
  //      Useful when the user has an unclaimed profile they typed
  //      during a match and wants to fold it into the bilaterally-
  //      auto-created linked profile.
  //   3. Both linked to the same friend → preserve that link.
  //      Standalone resolution of the same friend appearing twice.
  //   4. Both linked to *different* friends → silently swallowing
  //      one link is risky. Require `allowLinkedUserId` to match
  //      one side (the link-collision branch passes the friend's
  //      verified token; standalone callers must explicitly
  //      acknowledge the collision).
  //   5. Target unclaimed, source linked → would silently drop a
  //      link. Reject; the caller should swap directions.
  if (
    source.linkedUserId !== null &&
    target.linkedUserId === null
  ) {
    throw new ProfileMergeError(
      "Cannot merge a linked profile into an unclaimed one — swap source and target",
      409,
    );
  }
  if (
    target.linkedUserId !== null &&
    source.linkedUserId !== null &&
    target.linkedUserId !== source.linkedUserId
  ) {
    if (
      allowLinkedUserId === undefined ||
      (allowLinkedUserId !== target.linkedUserId &&
        allowLinkedUserId !== source.linkedUserId)
    ) {
      throw new ProfileMergeError(
        "Merging profiles linked to different accounts requires a confirming token",
        409,
      );
    }
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

  // Carry a custom avatar forward only when the survivor has none of
  // its own — never overwrite an owner-chosen photo on the target.
  if (!target.customAvatarUrl && source.customAvatarUrl) {
    await tx.profile.update({
      where: { id: targetProfileId },
      data: { customAvatarUrl: source.customAvatarUrl },
    });
  }

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
