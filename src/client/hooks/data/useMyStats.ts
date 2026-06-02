import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalPlayer, type LocalPlayerProfile } from "../../lib/db";
import { loadMatchVisibility } from "../../lib/visibility";

export type MyStatsFavouriteGame = {
  gameId: string;
  gameSlug: string;
  gameName: string;
  matches: number;
};

export type MyStatsFavouriteOpponent = {
  /** Deduplication key — `linkedUserId` when the opponent is a linked
   * person, otherwise `profile:{id}`. Stable across match sources. */
  key: string;
  /** Embedded profile projection used for alias/avatar rendering. */
  profile: LocalPlayerProfile;
  matches: number;
};

export type MyStats = {
  matchesPlayed: number;
  matchesCompleted: number;
  totalWins: number;
  /** Completed-match win rate (0..1). `null` when no completed match. */
  winRate: number | null;
  favouriteGame: MyStatsFavouriteGame | null;
  favouriteOpponent: MyStatsFavouriteOpponent | null;
};

/** Stable identity key for a person across Profile rows.
 *
 * Two `profiles.id` values can refer to the same person — typically
 * "me as owner" and "me as linked friend from another device". Keying
 * by `linkedUserId` collapses them so the ranking and the
 * "most-played opponent" counter don't double-count. Unlinked
 * aliases (no `linkedUserId`) stay distinct by profile id, which is
 * the right behaviour: my "Mum" and a friend's "Mum" are different
 * people for stats purposes until one of them gets linked. */
function personKey(p: Pick<LocalPlayer, "profile">): string {
  return p.profile.linkedUserId ?? `profile:${p.profile.id}`;
}

/**
 * Hero-strip totals for the signed-in user: matches played / completed
 * / wins, plus the "favourite" pills (most-played game, most-played
 * opponent). Computed live from Dexie. All counts respect the same
 * visibility predicate the rest of the UI uses, so a previous user's
 * matches on the same device never inflate the numbers.
 *
 * Wins are credited only when the viewer's Player row is the **outright**
 * `winnerId` of a `COMPLETED` match — ties / draws (null winnerId) don't
 * count. Opponents are everyone *else* who shared a visible match,
 * including unlinked aliases like "Mum".
 *
 * Returns `undefined` while the underlying Dexie reads are in flight.
 */
export function useMyStats(viewerId: string): MyStats | undefined {
  const data = useLiveQuery(async (): Promise<MyStats> => {
    const empty: MyStats = {
      matchesPlayed: 0,
      matchesCompleted: 0,
      totalWins: 0,
      winRate: null,
      favouriteGame: null,
      favouriteOpponent: null,
    };

    const owned = await db.profiles.where("ownerId").equals(viewerId).toArray();
    const self = owned.find((p) => p.linkedUserId === viewerId);
    if (!self) return empty;

    // Every Player row representing the viewer, across owner contexts.
    // Mirrors `collectPersonPlayers` in `useProfiles.ts`.
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
    if (myMatchIds.size === 0) return empty;

    const matchIdList = [...myMatchIds];
    const [matchRows, allPlayers, isVisible] = await Promise.all([
      db.matches.bulkGet(matchIdList),
      db.players.where("matchId").anyOf(matchIdList).toArray(),
      loadMatchVisibility(viewerId),
    ]);

    const playersByMatch = new Map<string, LocalPlayer[]>();
    for (const p of allPlayers) {
      const list = playersByMatch.get(p.matchId) ?? [];
      list.push(p);
      playersByMatch.set(p.matchId, list);
    }

    let matchesPlayed = 0;
    let matchesCompleted = 0;
    let totalWins = 0;
    const matchesByGame = new Map<string, number>();
    const opponentMatches = new Map<string, number>();
    // Track one representative Player row per opponent key — used at the
    // end to render the alias/avatar of the winning opponent.
    const opponentProfileSample = new Map<string, LocalPlayerProfile>();

    for (const match of matchRows) {
      if (!match) continue;
      const players = playersByMatch.get(match.id) ?? [];
      if (!isVisible(match, players)) continue;
      matchesPlayed += 1;
      matchesByGame.set(
        match.gameId,
        (matchesByGame.get(match.gameId) ?? 0) + 1,
      );
      if (match.status === "COMPLETED") {
        matchesCompleted += 1;
        if (match.winnerId && myPlayerIds.has(match.winnerId)) {
          totalWins += 1;
        }
      }
      for (const p of players) {
        // Skip every Player row representing me — opponents are
        // everyone else. The viewer can appear under multiple
        // Profile rows (own self-Profile + friend's linked mirror),
        // so we check both the Player id set and the linked-user
        // back-ref.
        if (myPlayerIds.has(p.id)) continue;
        if (p.profile.linkedUserId === viewerId) continue;
        const key = personKey(p);
        opponentMatches.set(key, (opponentMatches.get(key) ?? 0) + 1);
        if (!opponentProfileSample.has(key)) {
          opponentProfileSample.set(key, p.profile);
        }
      }
    }

    if (matchesPlayed === 0) return empty;

    let favouriteGame: MyStatsFavouriteGame | null = null;
    if (matchesByGame.size > 0) {
      const [topGameId, topCount] = pickTop(matchesByGame);
      const game = await db.games.get(topGameId);
      if (game) {
        favouriteGame = {
          gameId: game.id,
          gameSlug: game.slug,
          gameName: game.name,
          matches: topCount,
        };
      }
    }

    let favouriteOpponent: MyStatsFavouriteOpponent | null = null;
    if (opponentMatches.size > 0) {
      const [topKey, topCount] = pickTop(opponentMatches);
      const profile = opponentProfileSample.get(topKey);
      if (profile) {
        favouriteOpponent = {
          key: topKey,
          profile,
          matches: topCount,
        };
      }
    }

    return {
      matchesPlayed,
      matchesCompleted,
      totalWins,
      winRate: matchesCompleted > 0 ? totalWins / matchesCompleted : null,
      favouriteGame,
      favouriteOpponent,
    };
  }, [viewerId]);

  return data;
}

/** Reduce a `Map<K, number>` to the entry with the highest count. Ties
 * resolve to the first encountered — the iteration order matches
 * insertion order, so the first match to bump the counter wins. */
function pickTop<K>(counts: Map<K, number>): [K, number] {
  let best: [K, number] | null = null;
  for (const entry of counts) {
    if (!best || entry[1] > best[1]) best = entry;
  }
  // Caller has already checked `size > 0`.
  return best as [K, number];
}
