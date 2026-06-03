import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  type LocalGame,
  type LocalMatch,
  type LocalPlayer,
  type LocalProfile,
  type LocalScore,
} from "../../lib/db";
import { loadMatchVisibility } from "../../lib/visibility";
import { categoryToVictoryPoints } from "../../../shared/scoring/7-wonders-duel";

/** TEMPORARY DEV TOGGLE — set to true to render every stamp regardless
 * of actual state, so the icon set is visible in the UI without playing
 * matches. Must be `false` before commit. */
const FORCE_ALL_STAMPS_FOR_DEV = false;

export const TEN_WINS_THRESHOLD = 10;
export const WIN_STREAK_THRESHOLD = 5;
export const VETERAN_MATCHES_THRESHOLD = 50;
export const MARATHON_PER_DAY_THRESHOLD = 3;
export const ROUNDABOUT_OPPONENT_THRESHOLD = 5;
export const SIDEKICK_MATCHES_THRESHOLD = 10;
export const HABIT_DAYS_THRESHOLD = 5;
export const PIRATES_HAUL_THRESHOLD = 300;

const SLUG_SKULL_KING = "skull-king";
const SLUG_SEVEN_WONDERS_DUEL = "7-wonders-duel";
const ROUND_CATEGORY_RE = /^round_(\d+)$/;

export type AchievementKey =
  // v1 base set
  | "firstWin"
  | "tenWins"
  | "winStreak5"
  | "biggestBlowout"
  // activity
  | "veteran"
  | "marathon"
  | "acrossTheBoard"
  // victory style
  | "photoFinish"
  | "comebackSK"
  | "wireToWireSK"
  // skull king
  | "sealedLips"
  | "piratesHaul"
  | "perfectCall"
  // 7 wonders duel
  | "scientist"
  | "general"
  | "builder"
  // social
  | "roundabout"
  | "sidekick"
  | "theLink"
  // streak
  | "habit";

export type AchievementStamp = {
  key: AchievementKey;
  gameId: string | null;
  gameName: string | null;
  unlockedAt: string;
  /** Numeric body shown next to the label (margin, score total, count). */
  value?: number;
  /** Free-form sublabel — e.g. opponent alias for `sidekick`. */
  detail?: string;
};

/**
 * Live-query hook returning the unlocked achievement stamps for a given
 * Profile, scoped to matches the viewer can see (same predicate as the
 * rest of the stats stack). Same hook powers both the viewer's own
 * "Your stats" surface and a friend's profile page.
 *
 * Returns `undefined` while Dexie reads are in flight, or an array
 * sorted by unlock date descending (most recent first).
 */
export function useAchievements(
  profileId: string | undefined,
  viewerId: string,
): AchievementStamp[] | undefined {
  const data = useLiveQuery(async (): Promise<AchievementStamp[] | null> => {
    if (FORCE_ALL_STAMPS_FOR_DEV) {
      return demoStamps(await db.games.toArray());
    }

    if (!profileId) return null;

    const playersForProfile = await db.players
      .where("profileId")
      .equals(profileId)
      .toArray();

    // For the self-Profile we may still emit stamps even without any
    // match history (`theLink` is profile-link-based, not match-based),
    // so we don't return early here.
    const profilePlayerIds = new Set(playersForProfile.map((p) => p.id));
    const matchIds = [...new Set(playersForProfile.map((p) => p.matchId))];

    const [matchRows, allPlayers, allScores, games, isVisible, viewerOwned] =
      await Promise.all([
        matchIds.length > 0 ? db.matches.bulkGet(matchIds) : Promise.resolve([]),
        matchIds.length > 0
          ? db.players.where("matchId").anyOf(matchIds).toArray()
          : Promise.resolve([]),
        matchIds.length > 0
          ? db.scores.where("matchId").anyOf(matchIds).toArray()
          : Promise.resolve([]),
        db.games.toArray(),
        loadMatchVisibility(viewerId),
        db.profiles.where("ownerId").equals(viewerId).toArray(),
      ]);

    const selfProfile = viewerOwned.find((p) => p.linkedUserId === viewerId);
    const isSelf = selfProfile?.id === profileId;

    const playersByMatch = new Map<string, LocalPlayer[]>();
    for (const p of allPlayers) {
      const list = playersByMatch.get(p.matchId) ?? [];
      list.push(p);
      playersByMatch.set(p.matchId, list);
    }

    const gameById = new Map<string, LocalGame>();
    for (const g of games) gameById.set(g.id, g);

    const scoresByMatchPlayer = new Map<string, LocalScore[]>();
    for (const s of allScores) {
      const key = `${s.matchId}:${s.playerId}`;
      const list = scoresByMatchPlayer.get(key) ?? [];
      list.push(s);
      scoresByMatchPlayer.set(key, list);
    }

    const signals: MatchSignal[] = [];
    for (const m of matchRows) {
      if (!m || m.status !== "COMPLETED") continue;
      const matchPlayers = playersByMatch.get(m.id) ?? [];
      if (!isVisible(m, matchPlayers)) continue;
      const profilePlayer = matchPlayers.find((p) => profilePlayerIds.has(p.id));
      if (!profilePlayer) continue;
      signals.push(
        buildSignal({
          match: m,
          profilePlayer,
          matchPlayers,
          gameById,
          scoresByMatchPlayer,
          profilePlayerIds,
        }),
      );
    }
    signals.sort((a, b) => a.completedAt.localeCompare(b.completedAt));

    const stamps: AchievementStamp[] = [];

    pushFirstWin(stamps, signals);
    pushVeteran(stamps, signals);
    pushMarathon(stamps, signals);
    pushAcrossTheBoard(stamps, signals, games);
    pushPerGameWinStamps(stamps, signals, gameById);
    pushWinStreak(stamps, signals, gameById);
    pushPhotoFinish(stamps, signals, gameById);
    pushSkullKingStamps(stamps, signals);
    pushSevenWondersStamps(stamps, signals);
    pushRoundabout(stamps, signals, playersByMatch, profilePlayerIds);
    pushSidekick(stamps, signals, playersByMatch, profilePlayerIds);
    if (isSelf) pushTheLink(stamps, viewerOwned, viewerId);
    pushHabit(stamps, signals);

    stamps.sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt));
    return stamps;
  }, [profileId, viewerId]);

  return data ?? undefined;
}

// ─── Signal shape ────────────────────────────────────────────────────

type SkRoundEntry = { round: number; bid: number; tricks: number };

type MatchSignal = {
  match: LocalMatch;
  game: LocalGame | undefined;
  isWin: boolean;
  profilePlayerId: string;
  profileTotal: number;
  margin: number;
  isSK: boolean;
  isSWD: boolean;
  victoryType: string | null;
  completedAt: string;
  skRounds: SkRoundEntry[];
  /** round -> set of playerIds tied for leader after that round (SK only). */
  skLeaderByRound: Map<number, Set<string>>;
  /** category -> VP-converted total for profile's player (7WD only). */
  swdCategoryTotals: Map<string, number>;
};

function buildSignal(args: {
  match: LocalMatch;
  profilePlayer: LocalPlayer;
  matchPlayers: LocalPlayer[];
  gameById: Map<string, LocalGame>;
  scoresByMatchPlayer: Map<string, LocalScore[]>;
  profilePlayerIds: Set<string>;
}): MatchSignal {
  const { match: m, profilePlayer, matchPlayers, gameById, scoresByMatchPlayer, profilePlayerIds } = args;
  const game = gameById.get(m.gameId);
  const isSK = game?.slug === SLUG_SKULL_KING;
  const isSWD = game?.slug === SLUG_SEVEN_WONDERS_DUEL;

  const totals = new Map<string, number>();
  for (const pp of matchPlayers) {
    const total = (scoresByMatchPlayer.get(`${m.id}:${pp.id}`) ?? []).reduce(
      (sum, s) => sum + s.value,
      0,
    );
    totals.set(pp.id, total);
  }
  const profileTotal = totals.get(profilePlayer.id) ?? 0;
  const isWin = m.winnerId !== null && profilePlayerIds.has(m.winnerId);

  let margin = 0;
  if (m.winnerId !== null) {
    const winnerTotal = totals.get(m.winnerId) ?? 0;
    let runnerUp: number | null = null;
    for (const pp of matchPlayers) {
      if (pp.id === m.winnerId) continue;
      const t = totals.get(pp.id) ?? 0;
      if (runnerUp === null || t > runnerUp) runnerUp = t;
    }
    margin = runnerUp !== null ? winnerTotal - runnerUp : 0;
  }

  const skRounds: SkRoundEntry[] = [];
  const skLeaderByRound = new Map<number, Set<string>>();
  if (isSK) {
    const profileScores = scoresByMatchPlayer.get(`${m.id}:${profilePlayer.id}`) ?? [];
    for (const s of profileScores) {
      const rm = ROUND_CATEGORY_RE.exec(s.category);
      if (!rm) continue;
      const meta = s.metadata as { bid?: unknown; tricks?: unknown };
      if (typeof meta.bid !== "number" || typeof meta.tricks !== "number") continue;
      skRounds.push({ round: parseInt(rm[1], 10), bid: meta.bid, tricks: meta.tricks });
    }
    skRounds.sort((a, b) => a.round - b.round);

    // Per-round score table across all match players, then accumulate
    // cumulative totals and mark the leader(s) after every round.
    const roundScores = new Map<number, Map<string, number>>();
    for (const pp of matchPlayers) {
      const ppScores = scoresByMatchPlayer.get(`${m.id}:${pp.id}`) ?? [];
      for (const s of ppScores) {
        const rm = ROUND_CATEGORY_RE.exec(s.category);
        if (!rm) continue;
        const round = parseInt(rm[1], 10);
        let row = roundScores.get(round);
        if (!row) {
          row = new Map();
          roundScores.set(round, row);
        }
        row.set(pp.id, s.value);
      }
    }
    const sortedRounds = [...roundScores.keys()].sort((a, b) => a - b);
    const cumulative = new Map<string, number>();
    for (const pp of matchPlayers) cumulative.set(pp.id, 0);
    for (const r of sortedRounds) {
      const scoresForRound = roundScores.get(r);
      for (const pp of matchPlayers) {
        const v = scoresForRound?.get(pp.id) ?? 0;
        cumulative.set(pp.id, (cumulative.get(pp.id) ?? 0) + v);
      }
      let max = -Infinity;
      for (const v of cumulative.values()) if (v > max) max = v;
      const leaders = new Set<string>();
      for (const [pid, v] of cumulative) if (v === max) leaders.add(pid);
      skLeaderByRound.set(r, leaders);
    }
  }

  const swdCategoryTotals = new Map<string, number>();
  if (isSWD) {
    const profileScores = scoresByMatchPlayer.get(`${m.id}:${profilePlayer.id}`) ?? [];
    for (const s of profileScores) {
      // Treasury is stored as raw coins; convert to VP so the "largest
      // category" comparison in Builder reflects what actually drives
      // the win, not the raw input field.
      const vp = categoryToVictoryPointsOrRaw(s.category, s.value);
      swdCategoryTotals.set(s.category, (swdCategoryTotals.get(s.category) ?? 0) + vp);
    }
  }

  return {
    match: m,
    game,
    isWin,
    profilePlayerId: profilePlayer.id,
    profileTotal,
    margin,
    isSK,
    isSWD,
    victoryType: m.victoryType,
    completedAt: m.completedAt ?? m.updatedAt,
    skRounds,
    skLeaderByRound,
    swdCategoryTotals,
  };
}

function categoryToVictoryPointsOrRaw(category: string, value: number): number {
  // The shared helper is typed against `SevenWondersCategoryKey`. Any
  // foreign string just falls through to the raw value — safe since
  // those rows wouldn't exist on a 7WD match.
  try {
    return categoryToVictoryPoints(category as never, value);
  } catch {
    return value;
  }
}

// ─── Stamp emitters ──────────────────────────────────────────────────

function pushFirstWin(out: AchievementStamp[], signals: MatchSignal[]) {
  const first = signals.find((s) => s.isWin);
  if (!first) return;
  out.push({
    key: "firstWin",
    gameId: null,
    gameName: null,
    unlockedAt: first.completedAt,
  });
}

function pushVeteran(out: AchievementStamp[], signals: MatchSignal[]) {
  if (signals.length < VETERAN_MATCHES_THRESHOLD) return;
  out.push({
    key: "veteran",
    gameId: null,
    gameName: null,
    unlockedAt: signals[VETERAN_MATCHES_THRESHOLD - 1].completedAt,
    value: VETERAN_MATCHES_THRESHOLD,
  });
}

function pushMarathon(out: AchievementStamp[], signals: MatchSignal[]) {
  const byDay = new Map<string, MatchSignal[]>();
  for (const s of signals) {
    const day = s.completedAt.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(s);
    byDay.set(day, list);
  }
  let earliest: string | null = null;
  let countAtUnlock = 0;
  for (const [, daySigs] of byDay) {
    if (daySigs.length < MARATHON_PER_DAY_THRESHOLD) continue;
    daySigs.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    const trigger = daySigs[MARATHON_PER_DAY_THRESHOLD - 1].completedAt;
    if (earliest === null || trigger < earliest) {
      earliest = trigger;
      countAtUnlock = daySigs.length;
    }
  }
  if (earliest !== null) {
    out.push({
      key: "marathon",
      gameId: null,
      gameName: null,
      unlockedAt: earliest,
      value: countAtUnlock,
    });
  }
}

function pushAcrossTheBoard(
  out: AchievementStamp[],
  signals: MatchSignal[],
  games: LocalGame[],
) {
  if (games.length === 0) return;
  const firstWinByGame = new Map<string, string>();
  for (const s of signals) {
    if (!s.isWin) continue;
    const prev = firstWinByGame.get(s.match.gameId);
    if (prev === undefined || s.completedAt < prev) {
      firstWinByGame.set(s.match.gameId, s.completedAt);
    }
  }
  if (!games.every((g) => firstWinByGame.has(g.id))) return;
  const dates = [...firstWinByGame.values()];
  const latest = dates.reduce((max, d) => (d > max ? d : max));
  out.push({
    key: "acrossTheBoard",
    gameId: null,
    gameName: null,
    unlockedAt: latest,
  });
}

function pushPerGameWinStamps(
  out: AchievementStamp[],
  signals: MatchSignal[],
  gameById: Map<string, LocalGame>,
) {
  const winsByGame = new Map<string, MatchSignal[]>();
  for (const s of signals) {
    if (!s.isWin) continue;
    const list = winsByGame.get(s.match.gameId) ?? [];
    list.push(s);
    winsByGame.set(s.match.gameId, list);
  }
  for (const [gameId, gameWins] of winsByGame) {
    const gameName = gameById.get(gameId)?.name ?? null;
    gameWins.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    if (gameWins.length >= TEN_WINS_THRESHOLD) {
      out.push({
        key: "tenWins",
        gameId,
        gameName,
        unlockedAt: gameWins[TEN_WINS_THRESHOLD - 1].completedAt,
      });
    }
    const biggest = gameWins.reduce((max, w) => (w.margin > max.margin ? w : max));
    out.push({
      key: "biggestBlowout",
      gameId,
      gameName,
      unlockedAt: biggest.completedAt,
      value: biggest.margin,
    });
  }
}

function pushWinStreak(
  out: AchievementStamp[],
  signals: MatchSignal[],
  gameById: Map<string, LocalGame>,
) {
  const byGame = new Map<string, MatchSignal[]>();
  for (const s of signals) {
    const list = byGame.get(s.match.gameId) ?? [];
    list.push(s);
    byGame.set(s.match.gameId, list);
  }
  for (const [gameId, rows] of byGame) {
    rows.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    let run = 0;
    let unlockAt: string | null = null;
    for (const r of rows) {
      if (r.isWin) {
        run += 1;
        if (run >= WIN_STREAK_THRESHOLD) {
          unlockAt = r.completedAt;
          break;
        }
      } else {
        run = 0;
      }
    }
    if (unlockAt !== null) {
      out.push({
        key: "winStreak5",
        gameId,
        gameName: gameById.get(gameId)?.name ?? null,
        unlockedAt: unlockAt,
      });
    }
  }
}

function pushPhotoFinish(
  out: AchievementStamp[],
  signals: MatchSignal[],
  gameById: Map<string, LocalGame>,
) {
  const earliest = signals
    .filter((s) => s.isWin && s.margin === 1)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))[0];
  if (!earliest) return;
  out.push({
    key: "photoFinish",
    gameId: earliest.match.gameId,
    gameName: gameById.get(earliest.match.gameId)?.name ?? null,
    unlockedAt: earliest.completedAt,
  });
}

function pushSkullKingStamps(out: AchievementStamp[], signals: MatchSignal[]) {
  const skWins = signals
    .filter((s) => s.isSK && s.isWin)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  const emit = (key: AchievementKey, s: MatchSignal, value?: number) => {
    if (out.some((st) => st.key === key)) return;
    out.push({
      key,
      gameId: s.match.gameId,
      gameName: s.game?.name ?? null,
      unlockedAt: s.completedAt,
      ...(value !== undefined ? { value } : {}),
    });
  };

  for (const s of skWins) {
    if (s.profileTotal >= PIRATES_HAUL_THRESHOLD) emit("piratesHaul", s, s.profileTotal);
    if (s.skRounds.length > 0 && s.skRounds.every((r) => r.bid === r.tricks)) {
      emit("perfectCall", s);
    }
    if (s.skRounds.some((r) => r.bid === 0 && r.tricks === 0)) {
      emit("sealedLips", s);
    }
    const rounds = [...s.skLeaderByRound.keys()].sort((a, b) => a - b);
    if (rounds.length >= 2) {
      const allLeading = rounds.every((r) =>
        s.skLeaderByRound.get(r)?.has(s.profilePlayerId) === true,
      );
      if (allLeading) emit("wireToWireSK", s);
      const lastButOne = rounds[rounds.length - 2];
      const leaders = s.skLeaderByRound.get(lastButOne);
      if (leaders && !leaders.has(s.profilePlayerId)) emit("comebackSK", s);
    }
  }
}

function pushSevenWondersStamps(out: AchievementStamp[], signals: MatchSignal[]) {
  const wins = signals
    .filter((s) => s.isSWD && s.isWin)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  const emit = (key: AchievementKey, s: MatchSignal) => {
    if (out.some((st) => st.key === key)) return;
    out.push({
      key,
      gameId: s.match.gameId,
      gameName: s.game?.name ?? null,
      unlockedAt: s.completedAt,
    });
  };

  for (const s of wins) {
    if (s.victoryType === "scientific_supremacy") emit("scientist", s);
    if (s.victoryType === "military_supremacy") emit("general", s);
    if (s.victoryType === "score") {
      let maxCat = "";
      let maxVal = -Infinity;
      for (const [cat, v] of s.swdCategoryTotals) {
        if (v > maxVal) {
          maxVal = v;
          maxCat = cat;
        }
      }
      if (maxCat === "civil") emit("builder", s);
    }
  }
}

function pushRoundabout(
  out: AchievementStamp[],
  signals: MatchSignal[],
  playersByMatch: Map<string, LocalPlayer[]>,
  profilePlayerIds: Set<string>,
) {
  const firstSeen = new Map<string, string>();
  for (const s of signals) {
    const players = playersByMatch.get(s.match.id) ?? [];
    for (const pp of players) {
      if (profilePlayerIds.has(pp.id)) continue;
      const prev = firstSeen.get(pp.profileId);
      if (prev === undefined || s.completedAt < prev) {
        firstSeen.set(pp.profileId, s.completedAt);
      }
    }
  }
  if (firstSeen.size < ROUNDABOUT_OPPONENT_THRESHOLD) return;
  const sorted = [...firstSeen.values()].sort();
  out.push({
    key: "roundabout",
    gameId: null,
    gameName: null,
    unlockedAt: sorted[ROUNDABOUT_OPPONENT_THRESHOLD - 1],
    value: firstSeen.size,
  });
}

function pushSidekick(
  out: AchievementStamp[],
  signals: MatchSignal[],
  playersByMatch: Map<string, LocalPlayer[]>,
  profilePlayerIds: Set<string>,
) {
  // For each opponent (profileId), gather the matches we've played
  // together. Threshold = SIDEKICK_MATCHES_THRESHOLD. We surface only
  // the first opponent to cross the line; if multiple cross, the one
  // with the earliest unlock wins.
  const byOpponent = new Map<
    string,
    { matches: { signal: MatchSignal; alias: string }[] }
  >();
  for (const s of signals) {
    const players = playersByMatch.get(s.match.id) ?? [];
    const seenOpponents = new Set<string>();
    for (const pp of players) {
      if (profilePlayerIds.has(pp.id)) continue;
      if (seenOpponents.has(pp.profileId)) continue;
      seenOpponents.add(pp.profileId);
      const bucket = byOpponent.get(pp.profileId) ?? { matches: [] };
      bucket.matches.push({ signal: s, alias: pp.profile.alias });
      byOpponent.set(pp.profileId, bucket);
    }
  }

  type Candidate = { unlockAt: string; count: number; alias: string };
  let best: Candidate | null = null;
  for (const { matches } of byOpponent.values()) {
    if (matches.length < SIDEKICK_MATCHES_THRESHOLD) continue;
    matches.sort((a, b) => a.signal.completedAt.localeCompare(b.signal.completedAt));
    const trigger = matches[SIDEKICK_MATCHES_THRESHOLD - 1];
    const unlockAt = trigger.signal.completedAt;
    if (best === null || unlockAt < best.unlockAt) {
      best = { unlockAt, count: matches.length, alias: trigger.alias };
    }
  }
  if (best === null) return;
  out.push({
    key: "sidekick",
    gameId: null,
    gameName: null,
    unlockedAt: best.unlockAt,
    value: best.count,
    detail: best.alias,
  });
}

function pushTheLink(
  out: AchievementStamp[],
  viewerOwned: LocalProfile[],
  viewerId: string,
) {
  const linked = viewerOwned
    .filter((p) => p.linkedUserId !== null && p.linkedUserId !== viewerId)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  if (linked.length === 0) return;
  out.push({
    key: "theLink",
    gameId: null,
    gameName: null,
    unlockedAt: linked[0].updatedAt,
  });
}

function pushHabit(out: AchievementStamp[], signals: MatchSignal[]) {
  if (signals.length < HABIT_DAYS_THRESHOLD) return;
  const days = [...new Set(signals.map((s) => s.completedAt.slice(0, 10)))].sort();
  for (let i = 0; i + HABIT_DAYS_THRESHOLD - 1 < days.length; i += 1) {
    const slice = days.slice(i, i + HABIT_DAYS_THRESHOLD);
    let consecutive = true;
    for (let j = 1; j < slice.length; j += 1) {
      if (daysBetween(slice[j - 1], slice[j]) !== 1) {
        consecutive = false;
        break;
      }
    }
    if (!consecutive) continue;
    const finalDay = slice[slice.length - 1];
    const finalDaySignals = signals
      .filter((s) => s.completedAt.slice(0, 10) === finalDay)
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    out.push({
      key: "habit",
      gameId: null,
      gameName: null,
      unlockedAt: finalDaySignals[0].completedAt,
    });
    return;
  }
}

function daysBetween(d1: string, d2: string): number {
  const a = new Date(`${d1}T00:00:00Z`).getTime();
  const b = new Date(`${d2}T00:00:00Z`).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

// ─── Dev preview ─────────────────────────────────────────────────────

function demoStamps(games: LocalGame[]): AchievementStamp[] {
  const sk = games.find((g) => g.slug === SLUG_SKULL_KING);
  const swd = games.find((g) => g.slug === SLUG_SEVEN_WONDERS_DUEL);
  const skId = sk?.id ?? "demo-sk";
  const skName = sk?.name ?? "Skull King";
  const swdId = swd?.id ?? "demo-swd";
  const swdName = swd?.name ?? "7 Wonders Duel";
  const now = new Date().toISOString();
  return [
    { key: "firstWin", gameId: null, gameName: null, unlockedAt: now },
    { key: "tenWins", gameId: swdId, gameName: swdName, unlockedAt: now },
    { key: "winStreak5", gameId: swdId, gameName: swdName, unlockedAt: now },
    { key: "biggestBlowout", gameId: skId, gameName: skName, unlockedAt: now, value: 47 },
    { key: "veteran", gameId: null, gameName: null, unlockedAt: now, value: 50 },
    { key: "marathon", gameId: null, gameName: null, unlockedAt: now, value: 3 },
    { key: "acrossTheBoard", gameId: null, gameName: null, unlockedAt: now },
    { key: "photoFinish", gameId: swdId, gameName: swdName, unlockedAt: now },
    { key: "comebackSK", gameId: skId, gameName: skName, unlockedAt: now },
    { key: "wireToWireSK", gameId: skId, gameName: skName, unlockedAt: now },
    { key: "sealedLips", gameId: skId, gameName: skName, unlockedAt: now },
    { key: "piratesHaul", gameId: skId, gameName: skName, unlockedAt: now, value: 320 },
    { key: "perfectCall", gameId: skId, gameName: skName, unlockedAt: now },
    { key: "scientist", gameId: swdId, gameName: swdName, unlockedAt: now },
    { key: "general", gameId: swdId, gameName: swdName, unlockedAt: now },
    { key: "builder", gameId: swdId, gameName: swdName, unlockedAt: now },
    {
      key: "roundabout",
      gameId: null,
      gameName: null,
      unlockedAt: now,
      value: 5,
    },
    {
      key: "sidekick",
      gameId: null,
      gameName: null,
      unlockedAt: now,
      value: 10,
      detail: "Alice",
    },
    { key: "theLink", gameId: null, gameName: null, unlockedAt: now },
    { key: "habit", gameId: null, gameName: null, unlockedAt: now },
  ];
}
