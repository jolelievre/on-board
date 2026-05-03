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
 * Fetches the game list, then prefetches each game's detail page AND its
 * match history so the full per-game screen is available offline.
 */
export function usePrefetchGames() {
  const queryClient = useQueryClient();

  const { data: games } = useQuery<GameSummary[]>({
    queryKey: ["games"],
    queryFn: () => api<GameSummary[]>("/api/games"),
  });

  useEffect(() => {
    if (!games) return;
    console.info(
      `[prefetch] games list ready (${games.length} games), starting prefetch`,
      games.map((g) => g.slug),
    );
    for (const game of games) {
      const detailKey = ["games", game.slug];
      const matchesKey = ["matches", { gameId: game.id }];
      console.debug("[prefetch] schedule", detailKey, matchesKey);
      void queryClient
        .prefetchQuery({
          queryKey: detailKey,
          queryFn: () => api(`/api/games/${game.slug}`),
          staleTime: PREFETCH_THRESHOLD,
        })
        .then(() => console.debug("[prefetch] done", detailKey))
        .catch((err) => console.warn("[prefetch] fail", detailKey, err));
      void queryClient
        .prefetchQuery({
          queryKey: matchesKey,
          queryFn: () => api(`/api/matches?gameId=${game.id}`),
          staleTime: PREFETCH_THRESHOLD,
        })
        .then(() => console.debug("[prefetch] done", matchesKey))
        .catch((err) => console.warn("[prefetch] fail", matchesKey, err));
    }
  }, [games, queryClient]);
}
