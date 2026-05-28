import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import type { OwnedProfileIndex } from "../../../shared/players";

export type { OwnedProfileIndex } from "../../../shared/players";

const EMPTY_INDEX: OwnedProfileIndex = {
  byId: new Map(),
  byLinkedUserId: new Map(),
};

/**
 * Reactive index of the viewer's owned profiles, used by every
 * name-rendering site to look up "is there an owned profile that
 * represents this person, so I should show *my* alias for them?".
 *
 * The index is small (bounded by the number of friends the viewer has
 * added) and recomputed reactively via `useLiveQuery`, so any local
 * profile edit (rename, link, unlink, merge) immediately propagates
 * to every consumer's next render with no manual write-through.
 *
 * Returns an empty index while `viewerId` is undefined — call sites
 * that render before the session settles get the snapshot fallback
 * (`profile.alias`) which is the desired pre-auth behavior.
 */
export function useOwnedProfileIndex(
  viewerId: string | undefined,
): OwnedProfileIndex {
  const data = useLiveQuery(
    async (): Promise<OwnedProfileIndex> => {
      if (!viewerId) return EMPTY_INDEX;
      const rows = await db.profiles
        .where("ownerId")
        .equals(viewerId)
        .toArray();
      const byId: OwnedProfileIndex["byId"] = new Map();
      const byLinkedUserId: OwnedProfileIndex["byLinkedUserId"] = new Map();
      for (const p of rows) {
        byId.set(p.id, p);
        if (p.linkedUserId) byLinkedUserId.set(p.linkedUserId, p);
      }
      return { byId, byLinkedUserId };
    },
    [viewerId],
  );
  return data ?? EMPTY_INDEX;
}
