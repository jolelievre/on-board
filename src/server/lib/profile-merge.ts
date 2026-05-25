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
  // A profile is acceptable when either it's unclaimed OR its
  // `linkedUserId` matches the token-verified allowLinkedUserId the
  // caller passed in. Anything else (a different linked friend, or no
  // token at all on a linked profile) is rejected here so the link
  // and standalone paths share one source of truth.
  const targetOk =
    target.linkedUserId === null ||
    (allowLinkedUserId !== undefined &&
      target.linkedUserId === allowLinkedUserId);
  const sourceOk =
    source.linkedUserId === null ||
    (allowLinkedUserId !== undefined &&
      source.linkedUserId === allowLinkedUserId);
  if (!targetOk || !sourceOk) {
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
