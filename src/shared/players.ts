/**
 * Shared display-name and avatar resolution.
 *
 * Under the single-Profile model (PR 6-C) every Player references a
 * Profile; display flows through that Profile exclusively — no
 * fallback to a legacy `Player.name` snapshot.
 *
 * Names are resolved against the viewer's **owned profile index** so
 * the rendered label always reflects what the viewer chose locally:
 *
 *   1. If the row's profile id is one I own → use my profile.alias
 *      (the inflated snapshot embedded in a match may be stale; my
 *      Dexie row is the source of truth).
 *   2. Else if the row carries a `linkedUserId` and I own a profile
 *      with the same `linkedUserId` → use my profile.alias (this row
 *      represents someone I've bilaterally linked with; show how I
 *      label them, not how the other side does).
 *   3. Otherwise → fall back to `profile.alias` from the snapshot
 *      (the friend-of-friend case — I have no relation to this
 *      profile beyond seeing it in a shared match).
 *
 * The `ownedIndex` parameter is **required** so TypeScript catches
 * every call site if the contract evolves again. Pass the result of
 * `useOwnedProfileIndex(viewerId)` from a React component.
 */

/**
 * Read-only view of "the profiles I own", keyed two ways. Built by
 * the client's `useOwnedProfileIndex` hook from Dexie; defined here
 * so this module stays free of client-side imports.
 *
 * Members are intentionally minimal — only what `displayProfileName`
 * / `displayProfileAvatar` actually read.
 */
/** Mirrors `LocalProfile`'s stamp fields. Kept as a structural alias
 * so the shared resolver doesn't need to import the Dexie type. */
export type ProfileStampStyle = {
  /** "circle" | "rounded" | "tag" */
  avatarFrame: string;
  /** One of the 8 category keys, or null. */
  avatarRing: string | null;
};

export type OwnedProfileEntry = {
  id: string;
  alias: string;
  customAvatarUrl: string | null;
  useLinkedAvatar: boolean;
  /** Phase 7 — owner-controlled stamp style. Read by
   * `displayProfileStyle` so the viewer sees their own frame + ring
   * even on friend-created matches where the embedded Player.profile
   * snapshot carries the friend's choice. */
  avatarFrame: string;
  avatarRing: string | null;
  linkedUserId: string | null;
  linkedUser: {
    id: string;
    name: string;
    alias: string | null;
    avatarUrl: string | null;
  } | null;
};

export type OwnedProfileIndex = {
  byId: Map<string, OwnedProfileEntry>;
  byLinkedUserId: Map<string, OwnedProfileEntry>;
};

export type ProfileDisplayInput = {
  id: string;
  alias: string;
  customAvatarUrl?: string | null;
  useLinkedAvatar?: boolean;
  /** Phase 7 stamp style on the snapshot. Used as the fallback when
   * no owned-profile override applies (friend-of-friend case). */
  avatarFrame?: string;
  avatarRing?: string | null;
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

export function displayProfileName(
  profile: ProfileDisplayInput,
  ownedIndex: OwnedProfileIndex,
): string {
  const ownById = ownedIndex.byId.get(profile.id);
  if (ownById) return ownById.alias;
  if (profile.linkedUserId) {
    const ownByLinkedUser = ownedIndex.byLinkedUserId.get(profile.linkedUserId);
    if (ownByLinkedUser) return ownByLinkedUser.alias;
  }
  return profile.alias;
}

/**
 * Resolve the avatar URL for a Profile. Mirrors `displayProfileName`
 * by routing through the viewer's owned-profile index whenever the
 * row represents someone they have a stake in — i.e. it's their own
 * self-Profile, their own owned friend-profile, OR an embedded
 * projection (in a friend-created match) that points at the viewer
 * via `linkedUserId`. In all three cases, the viewer's OWN profile
 * row is the source of truth — its `customAvatarUrl` /
 * `useLinkedAvatar` toggle drive the resolution.
 *
 * Falls back to the embedded snapshot only for the "friend-of-friend"
 * case (no owned profile matches the row).
 *
 * Returns `null` when no avatar can be resolved — callers fall back
 * to an initials-based monogram.
 */
export function displayProfileAvatar(
  profile: ProfileDisplayInput,
  ownedIndex: OwnedProfileIndex,
): string | null {
  // "This row is mine" iff:
  //   - I own the profile by id (my self-Profile, or an owned
  //     friend-profile I've linked), OR
  //   - The row carries a `linkedUserId` matching one of my own
  //     profiles (a friend's projection of me — I should still see
  //     my own avatar choice, not the friend's nickname-photo of me).
  let mine = ownedIndex.byId.get(profile.id);
  if (!mine && profile.linkedUserId) {
    mine = ownedIndex.byLinkedUserId.get(profile.linkedUserId);
  }
  if (mine) {
    return resolveAvatarFromEntry(mine);
  }
  // Friend-of-friend / un-owned row: read from the embedded snapshot
  // honouring the original owner's `useLinkedAvatar` choice.
  if (profile.useLinkedAvatar !== false) {
    const linked = profile.linkedUser?.avatarUrl?.trim();
    if (linked) return linked;
  }
  return profile.customAvatarUrl?.trim() || null;
}

/** Apply the viewer's own resolution rules to one of their owned
 * profiles. Honours `useLinkedAvatar` so a self-Profile with a custom
 * upload + `useLinkedAvatar=false` returns the upload, not the
 * Google avatar. */
function resolveAvatarFromEntry(entry: OwnedProfileEntry): string | null {
  if (entry.useLinkedAvatar !== false) {
    const linked = entry.linkedUser?.avatarUrl?.trim();
    if (linked) return linked;
  }
  return entry.customAvatarUrl?.trim() || null;
}

/**
 * Resolve the stamp style (frame + ring) for a Profile. Mirrors
 * `displayProfileName` and `displayProfileAvatar` exactly: when the
 * row points at the viewer via id OR `linkedUserId`, return the
 * viewer's own profile's stamp (their self-chosen frame + ring).
 * Otherwise fall through to the embedded snapshot's stamp.
 *
 * Without this, a friend-created match would render the viewer's
 * seat with the FRIEND's stamp choice for that profile — which is
 * confusing on the viewer's side, since the viewer's own self-stamp
 * is what they expect to see for themselves.
 *
 * Defaults are baked in so callers never have to think about
 * `undefined`: missing/`undefined` frame → `"circle"`, missing/`undefined`
 * ring → `null`.
 */
export function displayProfileStyle(
  profile: ProfileDisplayInput,
  ownedIndex: OwnedProfileIndex,
): ProfileStampStyle {
  let mine = ownedIndex.byId.get(profile.id);
  if (!mine && profile.linkedUserId) {
    mine = ownedIndex.byLinkedUserId.get(profile.linkedUserId);
  }
  if (mine) {
    return {
      avatarFrame: mine.avatarFrame || "circle",
      avatarRing: mine.avatarRing ?? null,
    };
  }
  return {
    avatarFrame: profile.avatarFrame || "circle",
    avatarRing: profile.avatarRing ?? null,
  };
}

export function displayPlayerName(
  player: PlayerDisplayInput,
  ownedIndex: OwnedProfileIndex,
): string {
  return displayProfileName(player.profile, ownedIndex);
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
