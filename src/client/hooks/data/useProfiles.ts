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
 * Reactive list of profiles for the Players tab — friends only.
 *
 * Under the single-Profile model, the Players tab shows people the
 * viewer has played with. That excludes:
 *   - the viewer's self-Profile (ownerId === linkedUserId === me) —
 *     editing your own identity lives in Settings, not here.
 *   - profiles representing me from someone else's side
 *     (linkedUserId === me but ownerId !== me) — those rows belong to
 *     a friend who has me linked; I have no editorial role there.
 *
 * What's left: profiles I own where the linkedUserId is not me. That
 * captures unclaimed profiles ("Bob" I added before he signed up) and
 * linked friends (the same "Bob" once I scanned his QR).
 *
 * Pass `undefined` while session is still loading — the hook returns
 * `status: "loading"` until a real id is supplied.
 */
export function useProfileList(viewerId: string | undefined): UseProfileListResult {
  const data = useLiveQuery(
    async (): Promise<LocalProfile3[] | null> => {
      if (!viewerId) return null;
      const owned = await db.profiles.where("ownerId").equals(viewerId).toArray();
      const rows = owned.filter((p) => p.linkedUserId !== viewerId);
      // usedAt descending — most recently used friend first.
      rows.sort((a, b) => {
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

/**
 * Collect every Player row that represents the same *person* as the
 * given profile.
 *
 * Under the single-Profile model, a person is represented by one or
 * more Profile rows sharing the same `linkedUserId`. We mirror the
 * server's match-visibility predicate (`matchVisibilityWhere`) and
 * union two queries:
 *   - `profileId === profile.id` catches every Player row pointing
 *     directly at this Profile (the owner-side history, including
 *     rows written before the Profile was linked — their denormalised
 *     `profileLinkedUserId` is stale and the link transition does not
 *     bump `Match.updatedAt`, so pull-sync won't refresh them either).
 *   - `profileLinkedUserId === profile.linkedUserId` catches Player
 *     rows from matches created on another device under a *different*
 *     Profile row that shares the same linked auth user (the friend's
 *     own self-Profile).
 *
 * Without this union, freshly-linked profiles would lose their entire
 * pre-link match history from the UI until a full pull-sync rewrote
 * every affected Player row.
 */
async function collectPersonPlayers(
  profile: { id: string; linkedUserId: string | null },
): Promise<{ id: string; matchId: string }[]> {
  const directPromise = db.players
    .where("profileId")
    .equals(profile.id)
    .toArray();
  if (!profile.linkedUserId) return directPromise;

  const [direct, viaLinkedUser] = await Promise.all([
    directPromise,
    db.players
      .where("profileLinkedUserId")
      .equals(profile.linkedUserId)
      .toArray(),
  ]);
  const seen = new Set<string>();
  const merged: { id: string; matchId: string }[] = [];
  for (const p of [...direct, ...viaLinkedUser]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
  }
  return merged;
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
      const profile = await db.profiles.get(profileId);
      if (!profile) return null;
      const players = await collectPersonPlayers(profile);
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

export type ProfileSuggestion = {
  id: string;
  alias: string;
  isSelf: boolean;
  profile: LocalProfile3;
};

/**
 * Filtered profile list for the new-match picker. Wraps `useProfileList`
 * with two client-side reductions the picker always wants:
 *   - `query`: case-insensitive substring match on `alias`. An empty
 *     query returns every visible profile.
 *   - `excludeIds`: skip profiles already chosen in another slot. The
 *     picker computes this from the other slots' current `profileId`s.
 *
 * Returns the picker-shaped projection so the dropdown can mark "Me"
 * without rederiving the self-relationship in JSX.
 */
export function useProfileSuggestions(
  viewerId: string | undefined,
  query: string,
  excludeIds: Set<string>,
): ProfileSuggestion[] | undefined {
  const data = useLiveQuery(
    async (): Promise<LocalProfile3[] | null> => {
      if (!viewerId) return null;
      // The picker needs every owned profile *including the self-
      // Profile* (so "me" appears as a suggestion in match creation).
      // The Players tab listing in `useProfileList` separately filters
      // out the self-Profile because the tab is friend-only — keep
      // these two consumers' filters distinct.
      const owned = await db.profiles.where("ownerId").equals(viewerId).toArray();
      owned.sort((a, b) => {
        const aSelf = a.linkedUserId === viewerId ? 0 : 1;
        const bSelf = b.linkedUserId === viewerId ? 0 : 1;
        if (aSelf !== bSelf) return aSelf - bSelf;
        if (a.usedAt > b.usedAt) return -1;
        if (a.usedAt < b.usedAt) return 1;
        return a.alias.localeCompare(b.alias);
      });
      return owned;
    },
    [viewerId],
  );
  if (!data) return undefined;
  const needle = query.trim().toLowerCase();
  return data
    .filter((p) => !excludeIds.has(p.id))
    .filter((p) =>
      needle === "" ? true : p.alias.toLowerCase().includes(needle),
    )
    .map((p) => ({
      id: p.id,
      alias: p.alias,
      isSelf: p.linkedUserId === viewerId && p.ownerId === viewerId,
      profile: p,
    }));
}

export type PlayedWithGroup = {
  /** Ordered profile ids — preserved as the seating order from the
   * most-recent match this combination appeared in. */
  profileIds: string[];
  /** Resolved profile rows for rendering avatars + aliases in the chip.
   * Indices align with `profileIds`. */
  profiles: LocalProfile3[];
  /** `startedAt` of the most-recent match this exact group played. */
  lastPlayedAt: string;
};

/**
 * The 3 most recent unique player groupings the viewer has played with
 * for a given game — powers the "Played with" chips above the slot list
 * on the new-match form. Each group preserves the seating order from
 * its most-recent appearance so tapping a chip fills slots in the same
 * order the players sat last time.
 *
 * "Unique" is set-based on the profile ids — two matches with the same
 * roster in different seat orders count as one group. We deduplicate
 * from a recency-sorted scan and keep the first occurrence, so the
 * stored seating reflects the latest match featuring that exact crew.
 *
 * Returns `undefined` while Dexie reads are in flight. Returns `[]` when
 * the viewer has no matches for this game yet — the picker hides the
 * row in that case.
 */
export function usePlayedWith(
  viewerId: string | undefined,
  gameId: string | undefined,
  limit = 3,
): PlayedWithGroup[] | undefined {
  const data = useLiveQuery(
    async (): Promise<PlayedWithGroup[] | null> => {
      if (!viewerId || !gameId) return null;

      // Pull every match for this game and find ones we ourselves created.
      // Pre-filter on the indexed gameId column; the createdBy gate is in
      // memory because we don't carry an explicit createdById on
      // LocalMatch (the server enforces visibility, and Dexie only
      // contains rows we already pulled). All matches in our Dexie are
      // ones we can see — for now that's "ones we created" since cross-
      // user linking ships in 6-C.
      const matches = await db.matches.where("gameId").equals(gameId).toArray();
      if (matches.length === 0) return [];
      matches.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

      const seen = new Map<string, PlayedWithGroup>();
      // Collect the profile ids we'll need to hydrate at the end.
      const allProfileIds = new Set<string>();

      for (const m of matches) {
        const matchPlayers = await db.players
          .where("matchId")
          .equals(m.id)
          .sortBy("position");
        // A pre-6-A match may have null profileIds. Skip — we can't
        // build a stable chip without ids.
        const ids: string[] = [];
        let valid = true;
        for (const p of matchPlayers) {
          if (!p.profileId) {
            valid = false;
            break;
          }
          ids.push(p.profileId);
          allProfileIds.add(p.profileId);
        }
        if (!valid || ids.length === 0) continue;

        // Set-based dedup: sort the ids when computing the key so two
        // matches with the same roster in different seat orders collapse
        // to one group. We still store the un-sorted `ids` so the chip
        // fills slots in the latest seating that crew actually used —
        // the recency-first scan + first-occurrence rule above guarantees
        // that's the most recent match for this group.
        const key = [...ids].sort().join("|");
        if (seen.has(key)) continue;
        seen.set(key, {
          profileIds: ids,
          profiles: [], // filled below once we know which profiles to fetch
          lastPlayedAt: m.startedAt,
        });
        if (seen.size >= limit) break;
      }

      if (seen.size === 0) return [];

      const profileRows = await db.profiles.bulkGet([...allProfileIds]);
      const profilesById = new Map<string, LocalProfile3>();
      for (const p of profileRows) {
        if (p) profilesById.set(p.id, p);
      }

      // Drop any group whose profiles aren't fully hydrated locally
      // (the row was deleted, or pullSync hasn't caught up). The chip
      // would render as half-blanks otherwise.
      const groups: PlayedWithGroup[] = [];
      for (const g of seen.values()) {
        const hydrated = g.profileIds.map((id) => profilesById.get(id));
        if (hydrated.every((p): p is LocalProfile3 => p !== undefined)) {
          groups.push({ ...g, profiles: hydrated });
        }
      }
      return groups;
    },
    [viewerId, gameId, limit],
  );
  return data ?? undefined;
}

export type HeadToHeadRecord = {
  /** Total completed matches in which both profiles played. */
  matches: number;
  /** Wins for the *subject* profile (the one whose detail page we're on). */
  subjectWins: number;
  /** Wins for the viewer (the self-Profile). */
  viewerWins: number;
  /** Completed matches where neither side was the winner — Skull King ties,
   * 7WD draws. */
  draws: number;
};

/**
 * Head-to-head record between the subject profile and the viewer's
 * self-Profile, computed live from Dexie.
 *
 * "Both played" = at least one Player row in the same Match exists for
 * each profileId. Only `COMPLETED` matches feed the win/loss/draw
 * counters; the viewer-wins side reads `viewerSelfProfileId`, which the
 * caller is expected to derive from `useProfileList` (the self-Profile
 * is `ownerId === linkedUserId === viewerId`).
 *
 * Returns `undefined` while Dexie reads are in flight. Returns a
 * record with `matches: 0` when the two profiles have never shared a
 * completed match.
 */
export function useHeadToHead(
  subjectProfileId: string | undefined,
  viewerSelfProfileId: string | undefined,
): HeadToHeadRecord | undefined {
  return useLiveQuery(
    async (): Promise<HeadToHeadRecord> => {
      if (!subjectProfileId || !viewerSelfProfileId) {
        return { matches: 0, subjectWins: 0, viewerWins: 0, draws: 0 };
      }
      if (subjectProfileId === viewerSelfProfileId) {
        // No head-to-head against yourself.
        return { matches: 0, subjectWins: 0, viewerWins: 0, draws: 0 };
      }

      const [subjectProfile, viewerProfile] = await Promise.all([
        db.profiles.get(subjectProfileId),
        db.profiles.get(viewerSelfProfileId),
      ]);
      if (!subjectProfile || !viewerProfile) {
        return { matches: 0, subjectWins: 0, viewerWins: 0, draws: 0 };
      }

      // Collect every Player row representing the subject across
      // owners — `collectPersonPlayers` widens via
      // `Player.profileLinkedUserId`, so head-to-head picks up
      // matches the friend created with their own self-Profile too.
      const subjectPlayers = await collectPersonPlayers(subjectProfile);
      const matchIds = [...new Set(subjectPlayers.map((p) => p.matchId))];
      if (matchIds.length === 0) {
        return { matches: 0, subjectWins: 0, viewerWins: 0, draws: 0 };
      }

      const matches = await db.matches.bulkGet(matchIds);
      const allInMatch = await db.players
        .where("matchId")
        .anyOf(matchIds)
        .toArray();
      const playersByMatch = new Map<string, typeof allInMatch>();
      for (const p of allInMatch) {
        const list = playersByMatch.get(p.matchId) ?? [];
        list.push(p);
        playersByMatch.set(p.matchId, list);
      }

      const subjectPlayerIds = new Set(subjectPlayers.map((p) => p.id));
      // Same widening on the viewer side.
      const viewerPlayers = await collectPersonPlayers(viewerProfile);
      const viewerPlayerIds = new Set(viewerPlayers.map((p) => p.id));

      let total = 0;
      let subjectWins = 0;
      let viewerWins = 0;
      let draws = 0;

      for (const m of matches) {
        if (!m) continue;
        if (m.status !== "COMPLETED") continue;
        const inMatch = playersByMatch.get(m.id) ?? [];
        const subjectPlayer = inMatch.find((p) => subjectPlayerIds.has(p.id));
        const viewerPlayer = inMatch.find((p) => viewerPlayerIds.has(p.id));
        if (!subjectPlayer || !viewerPlayer) continue;
        total += 1;
        if (m.winnerId === subjectPlayer.id) subjectWins += 1;
        else if (m.winnerId === viewerPlayer.id) viewerWins += 1;
        else draws += 1;
      }

      return {
        matches: total,
        subjectWins,
        viewerWins,
        draws,
      };
    },
    [subjectProfileId, viewerSelfProfileId],
  );
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
      const profile = await db.profiles.get(profileId);
      if (!profile) return null;
      const players = await collectPersonPlayers(profile);
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
