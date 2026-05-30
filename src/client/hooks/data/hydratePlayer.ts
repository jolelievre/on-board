import type { LocalPlayer } from "../../lib/db";
import type { Player } from "../../types/match";

/**
 * Project a Dexie `LocalPlayer` row to the UI `Player` shape used by
 * `useMatch` and `useMatchList`. The embedded `profile` projection
 * (snapshotted at pull-sync time) is carried through as-is — display
 * callers read `player.profile.alias`, `player.profile.linkedUserId`,
 * etc. directly without an extra hook.
 */
export function projectPlayer(p: LocalPlayer): Player {
  return {
    id: p.id,
    position: p.position,
    profileId: p.profileId,
    profile: p.profile,
  };
}
