import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api";
import { db } from "../lib/db";

type PlayerSuggestion = { name: string; isSelf: boolean };

/**
 * Fetches player suggestions from the server when online.
 * Results are persisted to Dexie LocalProfiles so they're available
 * when the TanStack Query cache is absent (fresh install + offline).
 * Falls back to Dexie when the server request fails.
 */
export function usePlayerSuggestions() {
  const query = useQuery<PlayerSuggestion[]>({
    queryKey: ["players", "suggestions"],
    queryFn: () => api<PlayerSuggestion[]>("/api/players/suggestions"),
    // Don't throw on network error — we'll fall back to Dexie.
    retry: 0,
  });

  // Sync server results into Dexie on every successful fetch.
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

  return query;
}

/**
 * Saves a list of player names to Dexie LocalProfiles after a match is created.
 * Call this in the mutation's `onSuccess` handler.
 */
export async function persistPlayersToLocalProfiles(
  names: string[],
  selfName?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all(
    names.map((name) =>
      db.localProfiles.put({
        name,
        isSelf: selfName ? name === selfName : false,
        usedAt: now,
      }),
    ),
  );
}
