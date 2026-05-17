import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { db, type LocalProfile } from "../lib/db";

type PlayerSuggestion = { name: string; isSelf: boolean };

/**
 * Suggestions are resolved from two sources, in priority order:
 *
 *   1. The current auth session's `alias`/`name` — synthesises the self
 *      entry so it stays in sync with `updateProfile()` without an extra
 *      round-trip. Server's own self entry is intentionally ignored.
 *   2. Dexie `localProfiles` (non-self rows), populated by a background
 *      fetch of `/api/players/suggestions` on mount.
 *
 * `useLiveQuery` makes the Dexie read reactive: any write to
 * `localProfiles` (mirroring after fetch, or `persistPlayersToLocalProfiles`
 * after a new match) re-runs the predicate and re-renders consumers.
 *
 * Self is *never* mirrored into Dexie: persisting `{name: previousAlias,
 * isSelf: true}` would resurrect the previous alias as a phantom entry
 * after the user renames themselves.
 */
export function usePlayerSuggestions() {
  const { data: session } = authClient.useSession();
  const sessionUser = session?.user as
    | { name?: string | null; alias?: string | null }
    | undefined;
  const selfName =
    sessionUser?.alias?.trim() || sessionUser?.name?.trim() || "";

  // Background fetch + Dexie mirror. Self entry from the server response
  // is dropped — we synthesise it from the session below.
  useEffect(() => {
    let cancelled = false;
    void api<PlayerSuggestion[]>("/api/players/suggestions")
      .then(async (rows) => {
        if (cancelled) return;
        const now = new Date().toISOString();
        await Promise.all(
          rows
            .filter((s) => !s.isSelf)
            .map((s) =>
              db.localProfiles.put({
                name: s.name,
                isSelf: false,
                usedAt: now,
              }),
            ),
        );
      })
      .catch(() => {
        // Offline or transient failure — useLiveQuery still serves the
        // last-known Dexie state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const localProfiles = useLiveQuery<LocalProfile[], LocalProfile[]>(
    () => db.localProfiles.orderBy("usedAt").reverse().toArray(),
    [],
    [],
  );

  const seen = new Set<string>();
  const data: PlayerSuggestion[] = [];

  if (selfName) {
    seen.add(selfName.toLowerCase());
    data.push({ name: selfName, isSelf: true });
  }

  for (const row of localProfiles) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    data.push({ name: row.name, isSelf: false });
  }

  return { data };
}

/**
 * Saves a list of players to Dexie LocalProfiles after a match is created.
 *
 * `isSelf` is determined by `userId === selfUserId` — never by name equality.
 * Two friends sharing a first name (or a friend sharing the user's name) must
 * not stamp `isSelf: true` on the wrong row, which would pollute the
 * suggestion list and the userId attribution path on the next new-match form.
 */
export async function persistPlayersToLocalProfiles(
  players: { name: string; userId: string | null }[],
  selfUserId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all(
    players.map((p) =>
      db.localProfiles.put({
        name: p.name,
        isSelf: !!selfUserId && p.userId === selfUserId,
        usedAt: now,
      }),
    ),
  );
}
