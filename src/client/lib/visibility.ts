import { db, type LocalMatch, type LocalPlayer } from "./db";

/**
 * Client-side mirror of the server's `matchVisibilityWhere` predicate
 * (`src/server/lib/profile-scope.ts`). A match is visible to a viewer
 * when:
 *   1. they created it (`Match.createdById === viewerId`), or
 *   2. one of its Players references a Profile that the viewer either
 *      owns (`profile.ownerId === viewerId`) or is linked to
 *      (`profile.linkedUserId === viewerId`).
 *
 * Why this exists on the client at all: Phase 5c made Dexie the local
 * source of truth and every UI read hooks straight into it via
 * `useLiveQuery`. The server filters `GET /api/matches` by the same
 * predicate, but Dexie stores whatever the device has ever pulled —
 * including rows from a previous user who signed in on the same
 * device. Without a client-side scope, signing in as a different user
 * surfaces the prior user's matches until pull-sync would purge them
 * (which it doesn't, because we deliberately keep the data so the
 * original viewer's offline writes survive a sign-out / sign-in
 * cycle). The decision (per the PR 8-B design in PLAN.md): never
 * purge, always filter.
 */

/**
 * Loads the set of Profile ids the viewer can transitively reach. The
 * second half of the visibility predicate joins through Player → Profile;
 * pre-computing the set means `isMatchVisible` can run as a tight
 * synchronous check inside an existing read loop instead of issuing
 * a Dexie call per match.
 *
 * Includes profiles the viewer **owns** (`ownerId === viewerId` — the
 * self-Profile plus every friend-profile they created) and profiles
 * **linked to them** (`linkedUserId === viewerId` — a friend's row
 * representing the viewer after a bilateral QR link).
 */
export async function loadVisibleProfileIds(
  viewerId: string,
): Promise<Set<string>> {
  const [owned, linked] = await Promise.all([
    db.profiles.where("ownerId").equals(viewerId).toArray(),
    db.profiles.where("linkedUserId").equals(viewerId).toArray(),
  ]);
  const out = new Set<string>();
  for (const p of owned) out.add(p.id);
  for (const p of linked) out.add(p.id);
  return out;
}

/**
 * Synchronous match-visibility check. Caller pre-loads
 * `visibleProfileIds` once (via `loadVisibleProfileIds`) and re-uses
 * it across every match in the batch.
 *
 * The `match.createdById` field landed on `LocalMatch` in pull-sync
 * v6+; older rows pulled before the field was added may carry
 * `undefined` / `null`. We treat those as "creator unknown" → fall
 * back to the player-side check. This matches the server's `OR`
 * branch: a viewer who *participates* via any visible Profile still
 * sees the match even when we can't verify they created it.
 */
export function isMatchVisible(
  match: Pick<LocalMatch, "createdById">,
  matchPlayers: Pick<LocalPlayer, "profileId" | "profileLinkedUserId">[],
  viewerId: string,
  visibleProfileIds: Set<string>,
): boolean {
  if (match.createdById === viewerId) return true;
  for (const p of matchPlayers) {
    if (visibleProfileIds.has(p.profileId)) return true;
    // `profileLinkedUserId` is the denormalised mirror of
    // `profile.linkedUserId` (the viewer might be linked to a Profile
    // that hasn't been pulled into Dexie yet — for example a friend
    // created a match on their device, my pull-sync hydrated the
    // Player row including the link, but their Profile row itself is
    // outside my visibility). Checking this field too keeps the
    // client predicate honest on the "linked user as participant"
    // case without requiring a parallel Profile pull.
    if (p.profileLinkedUserId === viewerId) return true;
  }
  return false;
}
