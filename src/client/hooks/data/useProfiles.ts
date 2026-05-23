import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalProfile3 } from "../../lib/db";

export type DataStatus = "loading" | "ok" | "missing";

export type UseProfileListResult = {
  data: LocalProfile3[] | undefined;
  status: DataStatus;
};

export type UseProfileResult = {
  data: LocalProfile3 | undefined;
  status: DataStatus;
};

/**
 * Reactive list of profiles visible to the given viewer — that is,
 * profiles they own OR profiles linked to their own auth account.
 *
 * The self-Profile (where `linkedUserId === viewerId`) is pinned to the
 * top regardless of `usedAt`; remaining rows are sorted by `usedAt`
 * descending so the most recently used profile appears first.
 *
 * Pass `undefined` while session is still loading — the hook returns
 * `status: "loading"` until a real id is supplied.
 */
export function useProfileList(viewerId: string | undefined): UseProfileListResult {
  const data = useLiveQuery(
    async (): Promise<LocalProfile3[] | null> => {
      if (!viewerId) return null;
      // Dexie can't express OR across two columns natively. Two scans
      // joined in memory is fine at this scale — every Profile a user
      // can see is in their owned set or their linked set, and both
      // sets are tiny (10s, not 1000s).
      const [owned, linked] = await Promise.all([
        db.profiles.where("ownerId").equals(viewerId).toArray(),
        db.profiles.where("linkedUserId").equals(viewerId).toArray(),
      ]);
      const byId = new Map<string, LocalProfile3>();
      for (const p of owned) byId.set(p.id, p);
      for (const p of linked) byId.set(p.id, p);
      const rows = [...byId.values()];
      rows.sort((a, b) => {
        const aSelf = a.linkedUserId === viewerId ? 0 : 1;
        const bSelf = b.linkedUserId === viewerId ? 0 : 1;
        if (aSelf !== bSelf) return aSelf - bSelf;
        // usedAt descending — most recent first.
        if (a.usedAt > b.usedAt) return -1;
        if (a.usedAt < b.usedAt) return 1;
        return a.alias.localeCompare(b.alias);
      });
      return rows;
    },
    [viewerId],
  );

  if (data === undefined) return { data: undefined, status: "loading" };
  if (data === null) return { data: undefined, status: "loading" };
  return { data, status: "ok" };
}

/** Reactive read of one profile by id. Returns `status: "missing"` when
 * the profile isn't mirrored locally (out of viewer scope, deleted,
 * or pullSync hasn't run yet). */
export function useProfile(id: string | undefined): UseProfileResult {
  const data = useLiveQuery(
    async (): Promise<LocalProfile3 | null> => {
      if (!id) return null;
      const p = await db.profiles.get(id);
      return p ?? null;
    },
    [id],
  );

  if (data === undefined) return { data: undefined, status: "loading" };
  if (data === null) return { data: undefined, status: "missing" };
  return { data, status: "ok" };
}

export type ProfileStatsPerGame = {
  gameId: string;
  gameSlug: string;
  gameName: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
};

export type ProfileStats = {
  totalMatches: number;
  totalCompleted: number;
  totalWins: number;
  perGame: ProfileStatsPerGame[];
};

/**
 * Aggregate match stats for a given profile, computed live from Dexie.
 *
 * Strategy: pull every Player row for this profileId → group by
 * matchId → look up each Match → count wins via `Match.winnerId` (the
 * legacy Player.id reference, which still works because the relevant
 * Player row is the same one we just enumerated). Per-game totals fall
 * out of the same scan.
 *
 * Returns `undefined` while the underlying Dexie reads are in flight.
 */
export function useProfileStats(
  profileId: string | undefined,
): ProfileStats | undefined {
  const data = useLiveQuery(
    async (): Promise<ProfileStats | null> => {
      if (!profileId) return null;
      const players = await db.players
        .where("profileId")
        .equals(profileId)
        .toArray();
      if (players.length === 0) {
        return {
          totalMatches: 0,
          totalCompleted: 0,
          totalWins: 0,
          perGame: [],
        };
      }

      const playerIdsByMatch = new Map<string, Set<string>>();
      for (const p of players) {
        const set = playerIdsByMatch.get(p.matchId) ?? new Set<string>();
        set.add(p.id);
        playerIdsByMatch.set(p.matchId, set);
      }
      const matchIds = [...playerIdsByMatch.keys()];

      const matches = await db.matches.bulkGet(matchIds);
      const matchesById = new Map<
        string,
        { id: string; gameId: string; status: string; winnerId: string | null }
      >();
      for (const m of matches) {
        if (m) matchesById.set(m.id, m);
      }

      const gameIds = [...new Set([...matchesById.values()].map((m) => m.gameId))];
      const games = await db.games.bulkGet(gameIds);
      const gamesById = new Map<string, { id: string; slug: string; name: string }>();
      for (const g of games) {
        if (g) gamesById.set(g.id, { id: g.id, slug: g.slug, name: g.name });
      }

      const perGameMap = new Map<string, ProfileStatsPerGame>();
      let totalCompleted = 0;
      let totalWins = 0;

      for (const [matchId, playerIds] of playerIdsByMatch) {
        const match = matchesById.get(matchId);
        if (!match) continue;

        const gameInfo = gamesById.get(match.gameId);
        const entry =
          perGameMap.get(match.gameId) ??
          ({
            gameId: match.gameId,
            gameSlug: gameInfo?.slug ?? "",
            gameName: gameInfo?.name ?? "",
            matches: 0,
            wins: 0,
            losses: 0,
            draws: 0,
          } satisfies ProfileStatsPerGame);
        entry.matches += 1;

        if (match.status === "COMPLETED") {
          totalCompleted += 1;
          if (match.winnerId) {
            if (playerIds.has(match.winnerId)) {
              entry.wins += 1;
              totalWins += 1;
            } else {
              entry.losses += 1;
            }
          } else {
            entry.draws += 1;
          }
        }
        perGameMap.set(match.gameId, entry);
      }

      return {
        totalMatches: playerIdsByMatch.size,
        totalCompleted,
        totalWins,
        perGame: [...perGameMap.values()].sort((a, b) =>
          a.gameName.localeCompare(b.gameName),
        ),
      };
    },
    [profileId],
  );

  return data ?? undefined;
}

export type ProfileRecentMatch = {
  matchId: string;
  gameSlug: string;
  gameName: string;
  status: "IN_PROGRESS" | "COMPLETED";
  startedAt: string;
  completedAt: string | null;
  isWinner: boolean | null;
};

/** Most recent matches the profile participated in. Used on the profile
 * detail page. */
export function useProfileRecentMatches(
  profileId: string | undefined,
  limit = 10,
): ProfileRecentMatch[] | undefined {
  const data = useLiveQuery(
    async (): Promise<ProfileRecentMatch[] | null> => {
      if (!profileId) return null;
      const players = await db.players
        .where("profileId")
        .equals(profileId)
        .toArray();
      if (players.length === 0) return [];

      const playerById = new Map<string, string>();
      for (const p of players) playerById.set(p.id, p.matchId);

      const matchIds = [...new Set(players.map((p) => p.matchId))];
      const matches = await db.matches.bulkGet(matchIds);
      const validMatches = matches.filter(
        (m): m is NonNullable<typeof m> => m !== undefined,
      );
      validMatches.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

      const sliced = validMatches.slice(0, limit);
      const gameIds = [...new Set(sliced.map((m) => m.gameId))];
      const games = await db.games.bulkGet(gameIds);
      const gamesById = new Map<string, { slug: string; name: string }>();
      for (const g of games) {
        if (g) gamesById.set(g.id, { slug: g.slug, name: g.name });
      }

      const profilePlayerIdsByMatch = new Map<string, Set<string>>();
      for (const p of players) {
        const set = profilePlayerIdsByMatch.get(p.matchId) ?? new Set<string>();
        set.add(p.id);
        profilePlayerIdsByMatch.set(p.matchId, set);
      }

      return sliced.map((m) => {
        const gameInfo = gamesById.get(m.gameId);
        const playerIds = profilePlayerIdsByMatch.get(m.id) ?? new Set();
        let isWinner: boolean | null = null;
        if (m.status === "COMPLETED") {
          isWinner = m.winnerId ? playerIds.has(m.winnerId) : false;
        }
        return {
          matchId: m.id,
          gameSlug: gameInfo?.slug ?? "",
          gameName: gameInfo?.name ?? "",
          status: m.status,
          startedAt: m.startedAt,
          completedAt: m.completedAt,
          isWinner,
        };
      });
    },
    [profileId, limit],
  );

  return data ?? undefined;
}
