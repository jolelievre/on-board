import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { loadMatchVisibility } from "../../lib/visibility";
import type { Player } from "../../types/match";
import { projectPlayer } from "./hydratePlayer";

export type MatchListItem = {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  victoryType: string | null;
  winnerId: string | null;
  startedAt: string;
  completedAt: string | null;
  players: Player[];
  scores: { playerId: string; category: string; value: number }[];
};

export type DataStatus = "loading" | "ok" | "missing";

export type UseMatchListResult = {
  data: MatchListItem[] | undefined;
  status: DataStatus;
};

/**
 * Reactive list of matches scoped to the current viewer.
 *
 * Filters by the same predicate the server applies on `GET /matches`:
 * the viewer must have created the match OR participate via a Profile
 * they own / are linked to (`src/client/lib/visibility.ts`). Without
 * this, Dexie's "everything ever pulled on this device" model leaks a
 * previous user's matches into the next user's session on shared
 * devices (the bug surfaced during PR 8-A testing).
 *
 * `viewerId` is a required `string` — the caller obtains it via
 * `useRequiredViewerId()` so the type-checker enforces the scope at
 * every call site.
 */
export function useMatchList(
  viewerId: string,
  gameId?: string,
): UseMatchListResult {
  const data = useLiveQuery(
    async (): Promise<MatchListItem[]> => {
      const matches = gameId
        ? await db.matches.where("gameId").equals(gameId).toArray()
        : await db.matches.toArray();

      if (matches.length === 0) return [];

      const matchIds = matches.map((m) => m.id);
      const [allPlayers, allScores, isVisible] = await Promise.all([
        db.players.where("matchId").anyOf(matchIds).toArray(),
        db.scores.where("matchId").anyOf(matchIds).toArray(),
        loadMatchVisibility(viewerId),
      ]);

      const playersByMatch = new Map<string, Player[]>();
      // Keep a raw player list per match so the visibility check below
      // has access to `profileLinkedUserId` (which the projected
      // shape strips). Same loop fills both maps.
      const rawPlayersByMatch = new Map<
        string,
        { profileId: string; profileLinkedUserId: string | null }[]
      >();
      for (const p of allPlayers) {
        const list = playersByMatch.get(p.matchId) ?? [];
        list.push(projectPlayer(p));
        playersByMatch.set(p.matchId, list);
        const rawList = rawPlayersByMatch.get(p.matchId) ?? [];
        rawList.push({
          profileId: p.profileId,
          profileLinkedUserId: p.profileLinkedUserId,
        });
        rawPlayersByMatch.set(p.matchId, rawList);
      }
      for (const list of playersByMatch.values()) {
        list.sort((a, b) => a.position - b.position);
      }

      const scoresByMatch = new Map<
        string,
        { playerId: string; category: string; value: number }[]
      >();
      for (const s of allScores) {
        const list = scoresByMatch.get(s.matchId) ?? [];
        list.push({
          playerId: s.playerId,
          category: s.category,
          value: s.value,
        });
        scoresByMatch.set(s.matchId, list);
      }

      const visible = matches.filter((m) =>
        isVisible(m, rawPlayersByMatch.get(m.id) ?? []),
      );

      const out: MatchListItem[] = visible.map((m) => ({
        id: m.id,
        status: m.status,
        victoryType: m.victoryType,
        winnerId: m.winnerId,
        startedAt: m.startedAt,
        completedAt: m.completedAt,
        players: playersByMatch.get(m.id) ?? [],
        scores: scoresByMatch.get(m.id) ?? [],
      }));
      out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      return out;
    },
    [viewerId, gameId],
    [],
  );

  if (data === undefined) return { data: undefined, status: "loading" };
  return { data, status: "ok" };
}
