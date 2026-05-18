/**
 * Shared display-name resolution.
 *
 * Phase 6-A introduces the `Profile` domain entity as the canonical
 * person identity. Two helpers live here:
 *
 *   - `displayProfileName(profile, viewerId?)` — the new primary path.
 *     Returns the profile's canonical alias, or — when the viewer is
 *     the linked user themselves — their own auth identity (so a
 *     friend who gave me a silly nickname doesn't override what I see
 *     of myself).
 *
 *   - `displayPlayerName(player, viewerId?)` — back-compat wrapper.
 *     If the Player carries a denormalized `profile`, delegates to
 *     `displayProfileName`. Falls back to the legacy `linked user >
 *     player.name` path when no profile is attached (legacy cached
 *     rows pre-6-A, or server-side callers that don't join Profile).
 */

export type ProfileDisplayInput = {
  alias: string;
  linkedUserId?: string | null;
  linkedUser?: {
    name: string;
    alias: string | null;
  } | null;
};

export type PlayerDisplayInput = {
  name: string;
  /** Denormalized Profile join populated by `useMatch` / `useMatchList`. */
  profile?: ProfileDisplayInput | null;
  user?: {
    name: string;
    alias: string | null;
  } | null;
};

export function displayProfileName(
  profile: ProfileDisplayInput,
  viewerId?: string | null,
): string {
  // When the viewer IS the linked user, prefer their own auth-account
  // identity (which they edit via Settings → Alias). The owner's
  // Profile.alias is what other viewers see, but a person should see
  // themselves under the name they chose.
  if (profile.linkedUserId && viewerId && profile.linkedUserId === viewerId) {
    const ua = profile.linkedUser?.alias?.trim();
    if (ua) return ua;
    const un = profile.linkedUser?.name?.trim();
    if (un) return un;
  }
  return profile.alias;
}

export function displayPlayerName(
  player: PlayerDisplayInput,
  viewerId?: string | null,
): string {
  if (player.profile) return displayProfileName(player.profile, viewerId);
  // Legacy path — no Profile attached. Used by the server-side
  // suggestions endpoint and by any Dexie row that pre-dates 6-A.
  const alias = player.user?.alias?.trim();
  if (alias) return alias;
  const userName = player.user?.name?.trim();
  if (userName) return userName;
  return player.name;
}
