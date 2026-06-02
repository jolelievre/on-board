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
 * The `viewerId` parameter is a **required `string`** — never null,
 * never undefined. Callers under the `_authenticated/*` layout get one
 * via `useRequiredViewerId()`; everything else takes the string from
 * a parent that already has it. The hard requirement is what catches
 * the "I forgot to thread the viewer through, so I get an empty index
 * and the snapshot fallback kicks in" bug class at compile time
 * instead of in production. Mirrors the contract on `displayProfileName`
 * / `displayProfileAvatar`, both of which already require an
 * `OwnedProfileIndex`.
 */
export function useOwnedProfileIndex(viewerId: string): OwnedProfileIndex {
  const data = useLiveQuery(
    async (): Promise<OwnedProfileIndex> => {
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
