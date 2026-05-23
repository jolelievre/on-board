import { useLiveQuery } from "dexie-react-hooks";
import { authClient } from "../lib/auth-client";
import { db } from "../lib/db";
import { resolveSelfAlias } from "../../shared/players";

type PlayerSuggestion = { name: string; isSelf: boolean };

/**
 * Suggestions for the legacy new-match form (Phase 6-A: name-input mode
 * is still the default — the profile-picker UI ships in 6-B). Reads
 * exclusively from the server-mirrored `profiles` table:
 *
 *   1. Self entry — synthesised from the auth session so renames in
 *      Settings appear instantly without a server round-trip.
 *   2. Every profile the viewer can see (owned or linked), sorted by
 *      most-recently used. Self is excluded from this list because we
 *      always emit it first from the session.
 *
 * `useLiveQuery` makes the Dexie read reactive: any pullSync that
 * updates a profile re-runs the predicate and re-renders consumers.
 */
export function usePlayerSuggestions() {
  const { data: session } = authClient.useSession();
  const sessionUser = session?.user as
    | { id: string; name?: string | null; alias?: string | null }
    | undefined;
  const viewerId = sessionUser?.id;

  const profiles = useLiveQuery(
    async () => {
      if (!viewerId) return [];
      // Same OR shape as useProfileList — Dexie can't span two columns
      // natively, so two indexed scans joined in memory. The set is
      // small (10s of rows).
      const [owned, linked] = await Promise.all([
        db.profiles.where("ownerId").equals(viewerId).toArray(),
        db.profiles.where("linkedUserId").equals(viewerId).toArray(),
      ]);
      const byId = new Map<string, (typeof owned)[number]>();
      for (const p of owned) byId.set(p.id, p);
      for (const p of linked) byId.set(p.id, p);
      const rows = [...byId.values()];
      rows.sort((a, b) => (a.usedAt > b.usedAt ? -1 : a.usedAt < b.usedAt ? 1 : 0));
      return rows;
    },
    [viewerId],
    [],
  );

  // Prefer the self-Profile's alias over the session payload: renames
  // done via the Players tab call `patchProfile`, which updates Dexie's
  // self-Profile but doesn't touch `User.alias` (only the Settings page
  // does). `resolveSelfAlias` (shared with the server's self-Profile
  // provisioning) keeps the chip populated during the brief window
  // before pullSync has hydrated the self-Profile on a fresh boot.
  const selfProfile = profiles.find((p) => p.linkedUserId === viewerId);
  const selfName =
    selfProfile?.alias?.trim() ||
    (sessionUser
      ? resolveSelfAlias({
          name: sessionUser.name ?? "",
          alias: sessionUser.alias ?? null,
        })
      : "");

  const seen = new Set<string>();
  const data: PlayerSuggestion[] = [];

  if (selfName) {
    seen.add(selfName.toLowerCase());
    data.push({ name: selfName, isSelf: true });
  }

  for (const p of profiles) {
    // Skip the self-Profile — we synthesise the self entry from the
    // session above and never want it duplicated.
    if (p.linkedUserId === viewerId) continue;
    const key = p.alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    data.push({ name: p.alias, isSelf: false });
  }

  return { data };
}

/**
 * No-op after Phase 6-A: every Player row gets a Profile resolved
 * server-side, and the next pullSync brings those rows into Dexie's
 * `profiles` table — so suggestions automatically refresh without us
 * mirroring anything by hand.
 *
 * Kept as an exported shim so the existing new-match form (which calls
 * this after submit) compiles; can be deleted once 6-B converts the
 * form to the profile-picker mode.
 */
export async function persistPlayersToLocalProfiles(
  _players: { name: string; userId: string | null }[],
  _selfUserId: string | null,
): Promise<void> {
  // pullSync (kicked off after the match POST flushes) repopulates the
  // profiles table from the server. No client-side mirror needed.
}
