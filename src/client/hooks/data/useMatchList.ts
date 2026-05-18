import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import type { Player } from "../../types/match";

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

/** Reactive list of matches, optionally scoped to a game. Sorted by
 * startedAt descending so the most recent match is first. */
export function useMatchList(gameId?: string): UseMatchListResult {
  const data = useLiveQuery(
    async (): Promise<MatchListItem[]> => {
      const matches = gameId
        ? await db.matches.where("gameId").equals(gameId).toArray()
        : await db.matches.toArray();

      if (matches.length === 0) return [];

      const matchIds = matches.map((m) => m.id);
      const [allPlayers, allScores] = await Promise.all([
        db.players.where("matchId").anyOf(matchIds).toArray(),
        db.scores.where("matchId").anyOf(matchIds).toArray(),
      ]);

      // Bulk-fetch all referenced profiles once so the per-player
      // mapping below is O(N) instead of O(N*log N) per-row lookups.
      const profileIds = [
        ...new Set(
          allPlayers.map((p) => p.profileId).filter((x): x is string => !!x),
        ),
      ];
      const profiles = profileIds.length
        ? await db.profiles.bulkGet(profileIds)
        : [];
      const profileById = new Map<string, (typeof profiles)[number]>();
      for (const pr of profiles) {
        if (pr) profileById.set(pr.id, pr);
      }

      const playersByMatch = new Map<string, Player[]>();
      for (const p of allPlayers) {
        const list = playersByMatch.get(p.matchId) ?? [];
        const pr = p.profileId ? profileById.get(p.profileId) : null;
        list.push({
          id: p.id,
          name: p.name,
          position: p.position,
          profileId: p.profileId ?? null,
          profile: pr
            ? {
                alias: pr.alias,
                linkedUserId: pr.linkedUserId,
                linkedUser: pr.linkedUser,
              }
            : null,
          user: p.user ?? null,
        });
        playersByMatch.set(p.matchId, list);
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

      const out: MatchListItem[] = matches.map((m) => ({
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
    [gameId],
    [],
  );

  if (data === undefined) return { data: undefined, status: "loading" };
  return { data, status: "ok" };
}
