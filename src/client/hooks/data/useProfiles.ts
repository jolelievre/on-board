import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalProfile } from "../../lib/db";
import { loadMatchVisibility } from "../../lib/visibility";
import { projectPlayer } from "./hydratePlayer";
import type { MatchListItem } from "./useMatchList";

export type DataStatus = "loading" | "ok" | "missing";

export type UseProfileListResult = {
  data: LocalProfile[] | undefined;
  status: DataStatus;
};

export type UseProfileResult = {
  data: LocalProfile | undefined;
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
 * `viewerId` is required (`string`). Use `useRequiredViewerId()` at
 * the call site so the type-checker enforces the scope.
 */
export function useProfileList(viewerId: string): UseProfileListResult {
  const data = useLiveQuery(
    async (): Promise<LocalProfile[]> => {
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

/**
 * Reactive read of the viewer's self-Profile (the one with
 * `ownerId === linkedUserId === viewerId`, auto-created on first
 * login). Returns `undefined` while the pullSync that backfills the
 * row hasn't completed yet.
 *
 * Used by Settings to power the avatar editor — `useProfileList`
 * deliberately filters the self-Profile out of the friends list, so
 * Settings needs a dedicated read.
 */
export function useSelfProfile(viewerId: string): LocalProfile | undefined {
  return useLiveQuery(
    async (): Promise<LocalProfile | undefined> => {
      const owned = await db.profiles
        .where("ownerId")
        .equals(viewerId)
        .toArray();
      return owned.find((p) => p.linkedUserId === viewerId);
    },
    [viewerId],
  );
}

/**
 * Reactive read of one profile by id, scoped to the current viewer.
 * Returns `status: "missing"` when the profile isn't visible to the
 * viewer — either because the row isn't mirrored locally (out of
 * scope, deleted, pullSync hasn't run yet) OR because it belongs to
 * another account on the same device. Direct URL navigation to such
 * a profile must read as not-found, same as the server.
 */
export function useProfile(
  id: string | undefined,
  viewerId: string,
): UseProfileResult {
  const data = useLiveQuery(
    async (): Promise<LocalProfile | null> => {
      if (!id) return null;
      const p = await db.profiles.get(id);
      if (!p) return null;
      if (p.ownerId !== viewerId && p.linkedUserId !== viewerId) return null;
      return p;
    },
    [id, viewerId],
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
 * matchId → look up each Match → filter to ones the viewer can see →
 * count wins via `Match.winnerId` (the legacy Player.id reference,
 * which still works because the relevant Player row is the same one
 * we just enumerated). Per-game totals fall out of the same scan.
 *
 * The viewer filter is what prevents matches created by another
 * account on the same device from inflating stats for any profile —
 * including the subject profile, when that subject happens to be
 * linked to a person who has played matches that aren't visible to
 * the current viewer.
 *
 * Returns `undefined` while the underlying Dexie reads are in flight.
 */
export function useProfileStats(
  profileId: string | undefined,
  viewerId: string,
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

      const [matchRows, allInMatch, isVisible] = await Promise.all([
        db.matches.bulkGet(matchIds),
        db.players.where("matchId").anyOf(matchIds).toArray(),
        loadMatchVisibility(viewerId),
      ]);
      const playersForVisibility = new Map<
        string,
        { profileId: string; profileLinkedUserId: string | null }[]
      >();
      for (const p of allInMatch) {
        const list = playersForVisibility.get(p.matchId) ?? [];
        list.push({
          profileId: p.profileId,
          profileLinkedUserId: p.profileLinkedUserId,
        });
        playersForVisibility.set(p.matchId, list);
      }

      const matchesById = new Map<
        string,
        {
          id: string;
          gameId: string;
          status: string;
          winnerId: string | null;
          createdById?: string | null;
        }
      >();
      for (const m of matchRows) {
        if (!m) continue;
        if (!isVisible(m, playersForVisibility.get(m.id) ?? [])) continue;
        matchesById.set(m.id, m);
      }

      const gameIds = [...new Set([...matchesById.values()].map((m) => m.gameId))];
      const games = await db.games.bulkGet(gameIds);
      const gamesById = new Map<string, { id: string; slug: string; name: string }>();
      for (const g of games) {
        if (g) gamesById.set(g.id, { id: g.id, slug: g.slug, name: g.name });
      }

      const perGameMap = new Map<string, ProfileStatsPerGame>();
      let totalMatches = 0;
      let totalCompleted = 0;
      let totalWins = 0;

      for (const [matchId, playerIds] of playerIdsByMatch) {
        const match = matchesById.get(matchId);
        if (!match) continue;
        totalMatches += 1;

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
        totalMatches,
        totalCompleted,
        totalWins,
        perGame: [...perGameMap.values()].sort((a, b) =>
          a.gameName.localeCompare(b.gameName),
        ),
      };
    },
    [profileId, viewerId],
  );

  return data ?? undefined;
}

export type ProfileSuggestion = {
  id: string;
  alias: string;
  isSelf: boolean;
  profile: LocalProfile;
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
  viewerId: string,
  query: string,
  excludeIds: Set<string>,
): ProfileSuggestion[] | undefined {
  const data = useLiveQuery(
    async (): Promise<LocalProfile[]> => {
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
  profiles: LocalProfile[];
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
 * Matches are filtered by `loadMatchVisibility(viewerId)` so chips
 * from a previous account on the same device never leak into the
 * picker.
 *
 * Returns `undefined` while Dexie reads are in flight. Returns `[]` when
 * the viewer has no matches for this game yet — the picker hides the
 * row in that case.
 */
export function usePlayedWith(
  viewerId: string,
  gameId: string | undefined,
  limit = 3,
): PlayedWithGroup[] | undefined {
  const data = useLiveQuery(
    async (): Promise<PlayedWithGroup[] | null> => {
      if (!gameId) return null;

      const matches = await db.matches.where("gameId").equals(gameId).toArray();
      if (matches.length === 0) return [];
      matches.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

      const matchIds = matches.map((m) => m.id);
      const [allInMatch, isVisible] = await Promise.all([
        db.players.where("matchId").anyOf(matchIds).toArray(),
        loadMatchVisibility(viewerId),
      ]);
      const playersByMatch = new Map<string, typeof allInMatch>();
      for (const p of allInMatch) {
        const list = playersByMatch.get(p.matchId) ?? [];
        list.push(p);
        playersByMatch.set(p.matchId, list);
      }

      const seen = new Map<string, PlayedWithGroup>();
      // Collect the profile ids we'll need to hydrate at the end.
      const allProfileIds = new Set<string>();

      for (const m of matches) {
        const matchPlayers = playersByMatch.get(m.id) ?? [];
        if (!isVisible(m, matchPlayers)) continue;
        const ordered = [...matchPlayers].sort(
          (a, b) => a.position - b.position,
        );
        // A pre-6-A match may have null profileIds. Skip — we can't
        // build a stable chip without ids.
        const ids: string[] = [];
        let valid = true;
        for (const p of ordered) {
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
      const profilesById = new Map<string, LocalProfile>();
      for (const p of profileRows) {
        if (p) profilesById.set(p.id, p);
      }

      // Drop any group whose profiles aren't fully hydrated locally
      // (the row was deleted, or pullSync hasn't caught up). The chip
      // would render as half-blanks otherwise.
      const groups: PlayedWithGroup[] = [];
      for (const g of seen.values()) {
        const hydrated = g.profileIds.map((id) => profilesById.get(id));
        if (hydrated.every((p): p is LocalProfile => p !== undefined)) {
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
 * Matches outside the viewer's visibility are filtered out before
 * tallying — same predicate as the rest of the read hooks.
 *
 * Returns `undefined` while Dexie reads are in flight. Returns a
 * record with `matches: 0` when the two profiles have never shared a
 * completed match.
 */
export function useHeadToHead(
  subjectProfileId: string | undefined,
  viewerSelfProfileId: string | undefined,
  viewerId: string,
): HeadToHeadRecord | undefined {
  return useLiveQuery(
    async (): Promise<HeadToHeadRecord> => {
      const empty: HeadToHeadRecord = {
        matches: 0,
        subjectWins: 0,
        viewerWins: 0,
        draws: 0,
      };
      if (!subjectProfileId || !viewerSelfProfileId) return empty;
      if (subjectProfileId === viewerSelfProfileId) return empty;

      const [subjectProfile, viewerProfile] = await Promise.all([
        db.profiles.get(subjectProfileId),
        db.profiles.get(viewerSelfProfileId),
      ]);
      if (!subjectProfile || !viewerProfile) return empty;

      // Collect every Player row representing the subject across
      // owners — `collectPersonPlayers` widens via
      // `Player.profileLinkedUserId`, so head-to-head picks up
      // matches the friend created with their own self-Profile too.
      const subjectPlayers = await collectPersonPlayers(subjectProfile);
      const matchIds = [...new Set(subjectPlayers.map((p) => p.matchId))];
      if (matchIds.length === 0) return empty;

      const [matches, allInMatch, isVisible] = await Promise.all([
        db.matches.bulkGet(matchIds),
        db.players.where("matchId").anyOf(matchIds).toArray(),
        loadMatchVisibility(viewerId),
      ]);
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
        if (!isVisible(m, inMatch)) continue;
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
    [subjectProfileId, viewerSelfProfileId, viewerId],
  );
}

export type ProfileRecentMatch = {
  /** Game metadata for the row's label + score computation. */
  gameSlug: string;
  gameName: string;
  /** Full match shape so the shared `MatchHistoryRow` can render
   * the same player/score layout the per-game history uses. */
  match: MatchListItem;
};

/** Most recent matches the profile participated in, scoped to the
 * current viewer. Used on the profile detail page. Returns the full
 * `MatchListItem` shape (players + scores) so the shared
 * `MatchHistoryRow` component renders the same preview as the per-game
 * history. */
export function useProfileRecentMatches(
  profileId: string | undefined,
  viewerId: string,
  limit = 10,
): ProfileRecentMatch[] | undefined {
  const data = useLiveQuery(
    async (): Promise<ProfileRecentMatch[] | null> => {
      if (!profileId) return null;
      const profile = await db.profiles.get(profileId);
      if (!profile) return null;
      const players = await collectPersonPlayers(profile);
      if (players.length === 0) return [];

      const matchIds = [...new Set(players.map((p) => p.matchId))];
      const [matchRows, allInMatch, isVisible] = await Promise.all([
        db.matches.bulkGet(matchIds),
        db.players.where("matchId").anyOf(matchIds).toArray(),
        loadMatchVisibility(viewerId),
      ]);
      const playersByMatchForVisibility = new Map<string, typeof allInMatch>();
      for (const p of allInMatch) {
        const list = playersByMatchForVisibility.get(p.matchId) ?? [];
        list.push(p);
        playersByMatchForVisibility.set(p.matchId, list);
      }

      const validMatches = matchRows.filter(
        (m): m is NonNullable<typeof m> =>
          m !== undefined &&
          isVisible(m, playersByMatchForVisibility.get(m.id) ?? []),
      );
      validMatches.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

      const sliced = validMatches.slice(0, limit);
      if (sliced.length === 0) return [];

      const slicedIds = sliced.map((m) => m.id);
      const [allPlayers, allScores] = await Promise.all([
        db.players.where("matchId").anyOf(slicedIds).toArray(),
        db.scores.where("matchId").anyOf(slicedIds).toArray(),
      ]);

      const playersByMatch = new Map<string, ReturnType<typeof projectPlayer>[]>();
      for (const p of allPlayers) {
        const list = playersByMatch.get(p.matchId) ?? [];
        list.push(projectPlayer(p));
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

      const gameIds = [...new Set(sliced.map((m) => m.gameId))];
      const games = await db.games.bulkGet(gameIds);
      const gamesById = new Map<string, { slug: string; name: string }>();
      for (const g of games) {
        if (g) gamesById.set(g.id, { slug: g.slug, name: g.name });
      }

      return sliced.map((m) => {
        const gameInfo = gamesById.get(m.gameId);
        return {
          gameSlug: gameInfo?.slug ?? "",
          gameName: gameInfo?.name ?? "",
          match: {
            id: m.id,
            status: m.status,
            victoryType: m.victoryType,
            winnerId: m.winnerId,
            startedAt: m.startedAt,
            completedAt: m.completedAt,
            players: playersByMatch.get(m.id) ?? [],
            scores: scoresByMatch.get(m.id) ?? [],
          },
        };
      });
    },
    [profileId, viewerId, limit],
  );

  return data ?? undefined;
}
