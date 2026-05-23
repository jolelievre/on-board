import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import type { Match } from "../../types/match";
import { loadProfilesForPlayers, projectPlayer } from "./hydratePlayer";

export type DataStatus = "loading" | "ok" | "missing";

export type UseMatchResult = {
  data: Match | undefined;
  status: DataStatus;
};

/** Reactive read of a single match by id. Joins the match row with its
 * game, players, and scores rows so callers can keep treating it as the
 * existing `Match` shape. Returns `status: "missing"` when the match
 * row hasn't been pulled (or the id is bogus). */
export function useMatch(id: string): UseMatchResult {
  const data = useLiveQuery(
    async (): Promise<Match | null> => {
      const match = await db.matches.get(id);
      if (!match) return null;
      const [game, players, scores] = await Promise.all([
        db.games.get(match.gameId),
        db.players.where("matchId").equals(id).sortBy("position"),
        db.scores.where("matchId").equals(id).toArray(),
      ]);

      // Hydrate the Profile row for each Player so display callers can
      // resolve the canonical alias without an additional hook.
      const profileById = await loadProfilesForPlayers(players);

      return {
        id: match.id,
        status: match.status,
        victoryType: match.victoryType,
        winnerId: match.winnerId,
        metadata: match.metadata,
        game: game
          ? { id: game.id, slug: game.slug, name: game.name }
          : { id: match.gameId, slug: "", name: "" },
        players: players.map((p) => projectPlayer(p, profileById)),
        scores: scores.map((s) => ({
          playerId: s.playerId,
          category: s.category,
          value: s.value,
          metadata: s.metadata,
        })),
      };
    },
    [id],
  );

  if (data === undefined) return { data: undefined, status: "loading" };
  if (data === null) return { data: undefined, status: "missing" };
  return { data, status: "ok" };
}
