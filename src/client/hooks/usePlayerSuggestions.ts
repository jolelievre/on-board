import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { db } from "../lib/db";

type PlayerSuggestion = { name: string; isSelf: boolean };

/**
 * Suggestions are resolved from three sources, in priority order:
 *
 *   1. Server response (`/api/players/suggestions`) — authoritative when
 *      available; its self entry already reflects the current alias.
 *   2. Synthesized self entry from the auth session — used only when no
 *      server response has landed (offline first install / first paint).
 *   3. Dexie localProfiles fallback for offline / network-error states.
 *
 * The client never synthesizes the self chip when the server has answered:
 * `authClient.useSession()` can lag behind a recent `updateUser` call by a
 * tick or two, and its stale `alias` would otherwise resurrect the previous
 * value as a phantom self suggestion.
 *
 * Server results are mirrored into Dexie on success so the fallback stays
 * warm for future offline reads — but the self row is deliberately *not*
 * mirrored, since persisting `{name: previousAlias, isSelf: true}` would
 * leave a stale suggestion in Dexie after the alias changes.
 */
export function usePlayerSuggestions() {
  const { data: session } = authClient.useSession();
  const sessionUser = session?.user as
    | { name?: string | null; alias?: string | null }
    | undefined;
  const selfName =
    sessionUser?.alias?.trim() || sessionUser?.name?.trim() || "";

  const query = useQuery<PlayerSuggestion[]>({
    queryKey: ["players", "suggestions"],
    queryFn: () => api<PlayerSuggestion[]>("/api/players/suggestions"),
    // Don't throw on network error — we'll fall back to Dexie + self synth.
    retry: 0,
  });

  // Mirror non-self server entries into Dexie on every successful fetch.
  // The self entry is intentionally skipped: see header comment.
  useEffect(() => {
    if (!query.data) return;
    const now = new Date().toISOString();
    void Promise.all(
      query.data
        .filter((s) => !s.isSelf)
        .map((s) =>
          db.localProfiles.put({
            name: s.name,
            isSelf: false,
            usedAt: now,
          }),
        ),
    );
  }, [query.data]);

  // Read local profiles for the offline / no-server fallback. Re-runs when
  // the server data refreshes so the mirror stays in sync after flush.
  const [localProfiles, setLocalProfiles] = useState<PlayerSuggestion[] | null>(
    null,
  );
  useEffect(() => {
    void db.localProfiles
      .orderBy("usedAt")
      .reverse()
      .toArray()
      .then((rows) =>
        setLocalProfiles(
          rows.map((r) => ({ name: r.name, isSelf: !!r.isSelf })),
        ),
      );
  }, [query.data, selfName]);

  const suggestions = useMemo<PlayerSuggestion[]>(() => {
    const seen = new Set<string>();
    const out: PlayerSuggestion[] = [];

    if (query.data) {
      for (const s of query.data) {
        const key = s.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
      }
    } else if (selfName) {
      seen.add(selfName.toLowerCase());
      out.push({ name: selfName, isSelf: true });
    }

    for (const s of localProfiles ?? []) {
      const key = s.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: s.name, isSelf: false });
    }

    return out;
  }, [selfName, query.data, localProfiles]);

  return { ...query, data: suggestions };
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
