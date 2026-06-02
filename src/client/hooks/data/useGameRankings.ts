import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  type LocalPlayer,
  type LocalPlayerProfile,
} from "../../lib/db";
import { loadMatchVisibility } from "../../lib/visibility";

/** Minimum completed-match count for a participant's `winRate` to be
 * meaningful — a 100% rate from 1 match would otherwise dominate the
 * leaderboard. The UI displays unranked participants as `n/N` with the
 * raw count instead of a percentage. */
export const RANKING_MIN_MATCHES = 3;

export type GameRankingEntry = {
  /** Stable identity key — `linkedUserId` when set, otherwise
   * `profile:{profileId}`. Used by React keys and to compare entries. */
  key: string;
  /** Embedded profile projection for alias / avatar / stamp rendering.
   * Pulled from one Player row — non-owned profiles surfaced via shared
   * matches resolve correctly without needing a `profiles` row. */
  profile: LocalPlayerProfile;
  /** True when the entry represents the viewer themselves. */
  isMe: boolean;
  completedMatches: number;
  wins: number;
  /** wins / completedMatches (0..1). Only display the percentage when
   * `completedMatches >= RANKING_MIN_MATCHES`; below the gate the UI
   * should show the match count instead. */
  winRate: number;
  /** True iff `completedMatches >= RANKING_MIN_MATCHES`. Pre-computed
   * so the page doesn't repeat the threshold check. */
  ranked: boolean;
};

export type GameRankings = {
  /** Sorted: ranked entries first (by winRate desc, then matches desc),
   * then unranked entries (by matches desc), then alias as a tiebreak. */
  entries: GameRankingEntry[];
  minMatchesForRate: number;
};

/** See `useMyStats.personKey` — duplicated here to keep these hooks
 * independent. Consolidates Player rows that represent the same person
 * across owner contexts (linked persons collapse, unlinked aliases stay
 * distinct). */
function personKey(p: Pick<LocalPlayer, "profile">): string {
  return p.profile.linkedUserId ?? `profile:${p.profile.id}`;
}

/**
 * Per-game ranking of every Profile visible to the viewer that has
 * completed a match at this game — viewer included. "Visible" here
 * means the match passes the viewer's visibility predicate, so the
 * participant set widens beyond linked friends to include any
 * unclaimed alias the viewer has shared a match with (their own
 * "Mum", a friend's "Mum" surfaced through a shared match, etc.).
 *
 * Each entry carries enough metadata to render without further Dexie
 * lookups. The 3-match gate is encoded as the `ranked` flag — the UI
 * is responsible for switching between the `n/N` placeholder and a
 * concrete win-rate based on that flag.
 *
 * Returns `undefined` while Dexie reads are in flight, or when `gameId`
 * is unset.
 */
export function useGameRankings(
  viewerId: string,
  gameId: string | undefined,
): GameRankings | undefined {
  const data = useLiveQuery(async (): Promise<GameRankings | null> => {
    if (!gameId) return null;

    const [matches, isVisible] = await Promise.all([
      db.matches.where("gameId").equals(gameId).toArray(),
      loadMatchVisibility(viewerId),
    ]);
    if (matches.length === 0) {
      return { entries: [], minMatchesForRate: RANKING_MIN_MATCHES };
    }

    const matchIds = matches.map((m) => m.id);
    const allInMatch = await db.players
      .where("matchId")
      .anyOf(matchIds)
      .toArray();
    const playersByMatch = new Map<string, LocalPlayer[]>();
    for (const p of allInMatch) {
      const list = playersByMatch.get(p.matchId) ?? [];
      list.push(p);
      playersByMatch.set(p.matchId, list);
    }

    type Bucket = {
      key: string;
      profile: LocalPlayerProfile;
      isMe: boolean;
      completedMatches: number;
      wins: number;
    };
    const byKey = new Map<string, Bucket>();

    for (const m of matches) {
      if (m.status !== "COMPLETED") continue;
      const players = playersByMatch.get(m.id) ?? [];
      if (!isVisible(m, players)) continue;

      // Within a single match, the same person can in theory appear
      // under multiple Player rows (different owner sources of the
      // same linked user). Dedup per match before incrementing so a
      // single match never adds 2 to anyone's count.
      const seenInMatch = new Set<string>();
      for (const p of players) {
        const key = personKey(p);
        if (seenInMatch.has(key)) continue;
        seenInMatch.add(key);

        let bucket = byKey.get(key);
        if (!bucket) {
          bucket = {
            key,
            profile: p.profile,
            isMe: p.profile.linkedUserId === viewerId,
            completedMatches: 0,
            wins: 0,
          };
          byKey.set(key, bucket);
        }
        bucket.completedMatches += 1;
        // The winnerId is the Player row id; consider any of this
        // person's Player rows in this match as "their winning row".
        if (m.winnerId !== null) {
          const winnerInPersonSet = players.some(
            (pp) => pp.id === m.winnerId && personKey(pp) === key,
          );
          if (winnerInPersonSet) bucket.wins += 1;
        }
      }
    }

    const entries: GameRankingEntry[] = [...byKey.values()].map((b) => {
      const winRate =
        b.completedMatches > 0 ? b.wins / b.completedMatches : 0;
      return {
        key: b.key,
        profile: b.profile,
        isMe: b.isMe,
        completedMatches: b.completedMatches,
        wins: b.wins,
        winRate,
        ranked: b.completedMatches >= RANKING_MIN_MATCHES,
      };
    });

    entries.sort((a, b) => {
      if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
      if (a.ranked) {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      }
      if (b.completedMatches !== a.completedMatches) {
        return b.completedMatches - a.completedMatches;
      }
      return a.profile.alias.localeCompare(b.profile.alias);
    });

    return { entries, minMatchesForRate: RANKING_MIN_MATCHES };
  }, [viewerId, gameId]);

  return data ?? undefined;
}
