import type { Prisma } from "@prisma/client";

/** Bilaterally clear `linkedUserId` on a profile and its counterpart (the
 * profile owned by the linked user that points back at the target's
 * owner). Severing one side without the other leaves a confusing
 * half-state under the bilateral link model.
 *
 * No-op when the target has no linkedUserId. Tolerates legacy unilateral
 * links (no counterpart row) by clearing the target alone.
 *
 * Shared between `POST /api/profiles/:id/unlink` and `DELETE
 * /api/profiles/:id` (Phase 8-G), which need identical link-teardown
 * semantics before tombstoning. Callers wrap this in their own
 * `$transaction` so the unlink + downstream mutation (e.g. setting
 * `deletedAt`) commit atomically.
 *
 * Auth / self-Profile guards live in the route handler, not here —
 * this helper is the pure transactional core. */
export async function unlinkProfileBilateral(
  tx: Prisma.TransactionClient,
  profileId: string,
): Promise<void> {
  const target = await tx.profile.findUnique({
    where: { id: profileId },
    select: { id: true, ownerId: true, linkedUserId: true },
  });
  if (!target || target.linkedUserId === null) return;

  const counterpart = await tx.profile.findFirst({
    where: {
      ownerId: target.linkedUserId,
      linkedUserId: target.ownerId,
    },
    select: { id: true },
  });

  await tx.profile.update({
    where: { id: profileId },
    data: { linkedUserId: null },
  });
  if (counterpart) {
    await tx.profile.update({
      where: { id: counterpart.id },
      data: { linkedUserId: null },
    });
  }
}
