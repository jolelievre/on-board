import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { db } from "../lib/db";

type PlayerSuggestion = { name: string; isSelf: boolean };

/**
 * Suggestions are resolved from three sources, in priority order:
 *
 *   1. Synthesized self entry from the auth session — always present, even
 *      before any server response and on a fresh offline-first install.
 *   2. Server response (cached or live).
 *   3. Dexie localProfiles fallback for offline / network-error states.
 *
 * Names are deduplicated case-insensitively; the self entry always wins on
 * collisions. Server results are mirrored into Dexie on success so the
 * fallback stays warm for future offline reads.
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

  // Mirror server data into Dexie on every successful fetch.
  useEffect(() => {
    if (!query.data) return;
    const now = new Date().toISOString();
    void Promise.all(
      query.data.map((s) =>
        db.localProfiles.put({
          name: s.name,
          isSelf: s.isSelf,
          usedAt: now,
        }),
      ),
    );
  }, [query.data]);

  // Persist the synthesized self entry so it survives reloads even when the
  // server never responded.
  useEffect(() => {
    if (!selfName) return;
    void db.localProfiles.put({
      name: selfName,
      isSelf: true,
      usedAt: new Date().toISOString(),
    });
  }, [selfName]);

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

    if (selfName) {
      seen.add(selfName.toLowerCase());
      out.push({ name: selfName, isSelf: true });
    }

    const sources: PlayerSuggestion[][] = [
      query.data ?? [],
      localProfiles ?? [],
    ];

    for (const list of sources) {
      for (const s of list) {
        const key = s.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name: s.name, isSelf: false });
      }
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
