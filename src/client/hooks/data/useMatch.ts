import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { loadMatchVisibility } from "../../lib/visibility";
import type { Match } from "../../types/match";
import { projectPlayer } from "./hydratePlayer";

export type DataStatus = "loading" | "ok" | "missing";

export type UseMatchResult = {
  data: Match | undefined;
  status: DataStatus;
};

/**
 * Reactive read of a single match by id, gated by viewer visibility.
 * Joins the match row with its game, players, and scores rows so
 * callers can keep treating it as the existing `Match` shape.
 *
 * Returns `status: "missing"` both when the match row hasn't been
 * pulled (bogus id, pull-sync hasn't caught up) AND when the match
 * exists locally but isn't visible to the current viewer — direct
 * navigation to another user's match URL on a shared device must
 * read as "not found", same as the server. `viewerId` is required
 * (string) — obtain it via `useRequiredViewerId()`.
 */
export function useMatch(id: string, viewerId: string): UseMatchResult {
  const data = useLiveQuery(
    async (): Promise<Match | null> => {
      const match = await db.matches.get(id);
      if (!match) return null;

      const [game, players, scores, isVisible] = await Promise.all([
        db.games.get(match.gameId),
        db.players.where("matchId").equals(id).sortBy("position"),
        db.scores.where("matchId").equals(id).toArray(),
        loadMatchVisibility(viewerId),
      ]);

      if (!isVisible(match, players)) return null;

      return {
        id: match.id,
        status: match.status,
        victoryType: match.victoryType,
        winnerId: match.winnerId,
        metadata: match.metadata,
        game: game
          ? { id: game.id, slug: game.slug, name: game.name }
          : { id: match.gameId, slug: "", name: "" },
        players: players.map((p) => projectPlayer(p)),
        scores: scores.map((s) => ({
          playerId: s.playerId,
          category: s.category,
          value: s.value,
          metadata: s.metadata,
        })),
      };
    },
    [id, viewerId],
  );

  if (data === undefined) return { data: undefined, status: "loading" };
  if (data === null) return { data: undefined, status: "missing" };
  return { data, status: "ok" };
}
