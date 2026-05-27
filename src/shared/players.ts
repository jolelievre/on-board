/**
 * Shared display-name and avatar resolution.
 *
 * Under the single-Profile model (PR 6-C):
 *   - Every Player references a Profile. Display flows through that
 *     Profile exclusively — no fallback to a legacy `Player.name`
 *     or `Player.userId` snapshot.
 *   - A Profile's `alias` / `customAvatarUrl` belong to the owner.
 *     The owner is the only viewer who sees those values; every
 *     other viewer either sees the canonical linked-user identity
 *     (`linkedUser.name` / `linkedUser.avatarUrl`) when the profile
 *     is claimed, or just the alias when it is not.
 *   - Special case: when the viewer IS the linked user, the renderer
 *     prefers their own auth identity (alias → name) so they see
 *     themselves under the name they chose, not whatever nickname
 *     the owner assigned. Same rule applies to avatars.
 */

export type ProfileDisplayInput = {
  alias: string;
  customAvatarUrl?: string | null;
  useLinkedAvatar?: boolean;
  linkedUserId?: string | null;
  linkedUser?: {
    name: string;
    alias: string | null;
    avatarUrl?: string | null;
  } | null;
};

export type PlayerDisplayInput = {
  /** Denormalized Profile join — required under the single-Profile
   * model. The pull-sync projection embeds this on every Player row. */
  profile: ProfileDisplayInput;
};

/**
 * Resolve the display name for a Profile from the perspective of a
 * given viewer. The viewer's identity matters because someone seeing
 * themselves should never see the owner's private nickname for them.
 */
export function displayProfileName(
  profile: ProfileDisplayInput,
  viewerId?: string | null,
): string {
  if (profile.linkedUserId && viewerId && profile.linkedUserId === viewerId) {
    const ua = profile.linkedUser?.alias?.trim();
    if (ua) return ua;
    const un = profile.linkedUser?.name?.trim();
    if (un) return un;
  }
  return profile.alias;
}

/**
 * Resolve the avatar URL for a Profile from the perspective of a
 * given viewer. Mirrors `displayProfileName`'s viewer-aware logic:
 * the linked user sees their own auth avatar; everyone else sees the
 * owner's choice (custom upload or the linked-user's auth avatar
 * depending on the `useLinkedAvatar` toggle).
 *
 * Returns `null` when no avatar can be resolved — callers fall back
 * to an initials-based monogram.
 */
export function displayProfileAvatar(
  profile: ProfileDisplayInput,
  viewerId?: string | null,
): string | null {
  if (profile.linkedUserId && viewerId && profile.linkedUserId === viewerId) {
    return profile.linkedUser?.avatarUrl?.trim() || null;
  }
  if (profile.useLinkedAvatar !== false) {
    const linked = profile.linkedUser?.avatarUrl?.trim();
    if (linked) return linked;
  }
  return profile.customAvatarUrl?.trim() || null;
}

export function displayPlayerName(
  player: PlayerDisplayInput,
  viewerId?: string | null,
): string {
  return displayProfileName(player.profile, viewerId);
}

/**
 * Resolve the canonical alias for a self-Profile from the underlying
 * User row. Trimmed `alias` wins; otherwise the full `name`; finally a
 * hard-coded "Me" so the row is never blank in the suggestions list.
 *
 * Shared between the server (provisioning / mirroring the self-Profile
 * in `src/server/lib/profiles.ts`) and the client (Avatar / picker
 * fallbacks for fresh sessions before pullSync hydrates the
 * self-Profile) so all sites agree on the same fallback chain.
 */
export function resolveSelfAlias(user: {
  name: string;
  alias: string | null;
}): string {
  const alias = user.alias?.trim();
  if (alias) return alias;
  const name = user.name?.trim();
  if (name) return name;
  return "Me";
}
