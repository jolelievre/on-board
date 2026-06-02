import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalPlayer } from "../../lib/db";
import { loadMatchVisibility } from "../../lib/visibility";

export type MyGameStats = {
  matches: number;
  completed: number;
  wins: number;
  /** Wins / completed (0..1). `null` when no completed match. */
  winRate: number | null;
  /** Length of the win run ending at the most recent completed match.
   * Any loss / draw / non-1st result breaks it. */
  currentStreak: number;
  /** Longest win run across the viewer's full completed history. */
  maxStreak: number;
  /** Best per-match total score (sum of every category in `scores`)
   * the viewer recorded at this game. `null` when no completed match. */
  bestScore: number | null;
};

/**
 * Per-game personal stats for the signed-in user. Counts only matches
 * passing the viewer's visibility predicate; wins are credited only on
 * outright `winnerId` matches (ties / draws break streaks).
 *
 * Streak ordering uses `completedAt` (with `updatedAt` as a fallback
 * for the rare row where the field is null), so retroactively-completed
 * matches slot into the natural experience-time order. The current
 * streak is the trailing run of consecutive wins; max streak is the
 * longest run anywhere in history.
 *
 * `bestScore` sums every `scores` row belonging to any of the viewer's
 * Player ids in a given match, then keeps the largest match-total.
 * Works uniformly across game types because both 7WD and Skull King
 * encode per-category contributions in `scores` whose sum equals the
 * displayed match total.
 *
 * Returns `undefined` while Dexie reads are in flight, or when `gameId`
 * is unset.
 */
export function useMyGameStats(
  viewerId: string,
  gameId: string | undefined,
): MyGameStats | undefined {
  const data = useLiveQuery(async (): Promise<MyGameStats | null> => {
    if (!gameId) return null;
    const owned = await db.profiles.where("ownerId").equals(viewerId).toArray();
    const self = owned.find((p) => p.linkedUserId === viewerId);
    if (!self) return zero();

    const [direct, viaLinked] = await Promise.all([
      db.players.where("profileId").equals(self.id).toArray(),
      db.players.where("profileLinkedUserId").equals(viewerId).toArray(),
    ]);
    const myPlayerIds = new Set<string>();
    const myMatchIds = new Set<string>();
    for (const p of [...direct, ...viaLinked]) {
      myPlayerIds.add(p.id);
      myMatchIds.add(p.matchId);
    }
    if (myMatchIds.size === 0) return zero();

    const matchIdList = [...myMatchIds];
    const [matchRows, allPlayers, allScores, isVisible] = await Promise.all([
      db.matches.bulkGet(matchIdList),
      db.players.where("matchId").anyOf(matchIdList).toArray(),
      db.scores.where("matchId").anyOf(matchIdList).toArray(),
      loadMatchVisibility(viewerId),
    ]);

    const playersByMatch = new Map<string, LocalPlayer[]>();
    for (const p of allPlayers) {
      const list = playersByMatch.get(p.matchId) ?? [];
      list.push(p);
      playersByMatch.set(p.matchId, list);
    }

    const myMatchesAtGame = matchRows.filter(
      (m): m is NonNullable<typeof m> =>
        m !== undefined &&
        m.gameId === gameId &&
        isVisible(m, playersByMatch.get(m.id) ?? []),
    );

    // Sum my scores per match, keyed by matchId.
    const myScoreByMatch = new Map<string, number>();
    for (const s of allScores) {
      if (!myPlayerIds.has(s.playerId)) continue;
      myScoreByMatch.set(
        s.matchId,
        (myScoreByMatch.get(s.matchId) ?? 0) + s.value,
      );
    }

    const matches = myMatchesAtGame.length;
    let completed = 0;
    let wins = 0;
    let bestScore: number | null = null;

    type CompletedEntry = { completedAt: string; isWin: boolean };
    const completedEntries: CompletedEntry[] = [];

    for (const m of myMatchesAtGame) {
      if (m.status !== "COMPLETED") continue;
      completed += 1;
      const isWin = m.winnerId !== null && myPlayerIds.has(m.winnerId);
      if (isWin) wins += 1;
      completedEntries.push({
        completedAt: m.completedAt ?? m.updatedAt,
        isWin,
      });
      const myTotal = myScoreByMatch.get(m.id);
      if (myTotal !== undefined) {
        if (bestScore === null || myTotal > bestScore) bestScore = myTotal;
      }
    }

    // Ascending — current streak is the run ending at the last entry.
    completedEntries.sort((a, b) =>
      a.completedAt.localeCompare(b.completedAt),
    );
    let maxStreak = 0;
    let run = 0;
    for (const r of completedEntries) {
      if (r.isWin) {
        run += 1;
        if (run > maxStreak) maxStreak = run;
      } else {
        run = 0;
      }
    }
    const currentStreak = run;

    return {
      matches,
      completed,
      wins,
      winRate: completed > 0 ? wins / completed : null,
      currentStreak,
      maxStreak,
      bestScore,
    };
  }, [viewerId, gameId]);

  return data ?? undefined;
}

function zero(): MyGameStats {
  return {
    matches: 0,
    completed: 0,
    wins: 0,
    winRate: null,
    currentStreak: 0,
    maxStreak: 0,
    bestScore: null,
  };
}
