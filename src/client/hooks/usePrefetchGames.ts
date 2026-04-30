import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type GameSummary = { id: string; slug: string };

// Skip the prefetch if data was fetched within the last hour — avoids
// redundant requests on every page navigation while still ensuring
// game details are cached after at most one hour online.
const PREFETCH_THRESHOLD = 60 * 60 * 1000;

/**
 * Fires on every authenticated session.
 * Fetches the game list, then prefetches each game's detail page so that
 * unvisited games are available in the offline cache.
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
    }
  }, [games, queryClient]);
}
