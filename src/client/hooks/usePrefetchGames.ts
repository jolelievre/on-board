import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Match } from "../types/match";

type GameSummary = { id: string; slug: string };

// Skip the prefetch if data was fetched within the last hour — avoids
// redundant requests on every page navigation while still ensuring
// game details are cached after at most one hour online.
const PREFETCH_THRESHOLD = 60 * 60 * 1000;

/**
 * Fires on every authenticated session.
 *
 * Three-tier prefetch:
 *   1. Game list (`["games"]`)
 *   2. Per-game detail + match history (`["games", slug]`, `["matches", { gameId }]`)
 *   3. Match-detail keys hydrated from the list response — the list endpoint
 *      already returns each match with `players` + `scores`, so we copy each
 *      entry into `["matches", id]` via `setQueryData` instead of refetching.
 *      This gives `/matches/:id` an offline cache hit on the user's history
 *      without extra HTTP traffic.
 */
export function usePrefetchGames() {
  const queryClient = useQueryClient();

  const { data: games } = useQuery<GameSummary[]>({
    queryKey: ["games"],
    queryFn: () => api<GameSummary[]>("/api/games"),
  });

  useEffect(() => {
    if (!games) return;
    for (const game of games) {
      void queryClient.prefetchQuery({
        queryKey: ["games", game.slug],
        queryFn: () => api(`/api/games/${game.slug}`),
        staleTime: PREFETCH_THRESHOLD,
      });
      void queryClient
        .fetchQuery<Match[]>({
          queryKey: ["matches", { gameId: game.id }],
          queryFn: () => api<Match[]>(`/api/matches?gameId=${game.id}`),
          staleTime: PREFETCH_THRESHOLD,
        })
        .then((matches) => {
          if (!Array.isArray(matches)) return;
          for (const match of matches) {
            // Only seed the per-match cache if it isn't already present —
            // a freshly-fetched detail (with potentially newer scores) wins
            // over the list snapshot.
            if (queryClient.getQueryData(["matches", match.id])) continue;
            queryClient.setQueryData(["matches", match.id], match);
          }
        })
        .catch(() => {
          // Offline / network error — fine, the persisted cache (if any)
          // already covers this case.
        });
    }
  }, [games, queryClient]);
}
