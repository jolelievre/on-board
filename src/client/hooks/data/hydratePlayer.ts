import { db, type LocalPlayer, type LocalProfile3 } from "../../lib/db";
import type { Player } from "../../types/match";

/**
 * Bulk-fetch the Profile rows referenced by a set of Player rows. Returns
 * a `Map<profileId, profile>` so callers can attach the join without an
 * additional Dexie hop per player. Players without a `profileId` are
 * skipped silently — they're legacy cached rows from before 6-A.
 */
export async function loadProfilesForPlayers(
  players: Pick<LocalPlayer, "profileId">[],
): Promise<Map<string, LocalProfile3>> {
  const profileIds = [
    ...new Set(players.map((p) => p.profileId).filter((x): x is string => !!x)),
  ];
  if (!profileIds.length) return new Map();
  const rows = await db.profiles.bulkGet(profileIds);
  const byId = new Map<string, LocalProfile3>();
  for (const row of rows) {
    if (row) byId.set(row.id, row);
  }
  return byId;
}

/**
 * Project a Dexie `LocalPlayer` row to the UI `Player` shape used by
 * `useMatch` and `useMatchList`. Denormalises the Profile join when the
 * row's `profileId` resolves in `profileById`, so display callers can
 * read `player.profile.alias` directly without an extra hook.
 */
export function projectPlayer(
  p: LocalPlayer,
  profileById: Map<string, LocalProfile3>,
): Player {
  const pr = p.profileId ? profileById.get(p.profileId) ?? null : null;
  return {
    id: p.id,
    name: p.name,
    position: p.position,
    profileId: p.profileId ?? null,
    profile: pr
      ? {
          alias: pr.alias,
          linkedUserId: pr.linkedUserId,
          linkedUser: pr.linkedUser,
        }
      : null,
    user: p.user ?? null,
  };
}
