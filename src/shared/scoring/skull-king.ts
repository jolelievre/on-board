/**
 * Skull King — Classic scoring rules.
 *
 * Per round (round N = N cards dealt):
 *   - bid = 0, made (zero tricks):    +10 × N
 *   - bid = 0, missed (any tricks):   −10 × N
 *   - bid > 0, made (exact):          +20 × bid
 *   - bid > 0, missed (off by any):   −10 × |bid − tricks|
 *
 * Bonuses (added on top regardless of whether the bid was made or missed):
 *   - color14            +10 each (max 3 per round, one per color)
 *   - black14 (trump)    +20      (max 1 per round)
 *   - mermaidByPirate    +20 each (max 2 per round)
 *   - pirateBySK         +30 each (max 6 per round, 5 pirates + Tigress)
 *   - skByMermaid        +40      (max 1 per round)
 *
 * Total deck (Classic, no Loot expansion): 56 numbered + 14 specials = 70.
 */

export const SKULL_KING_TOTAL_ROUNDS = 10;

/** Max number of bonus captures per round per type (Classic deck). */
export const SK_BONUS_MAX = {
  color14: 3,
  black14: 1,
  mermaidByPirate: 2,
  pirateBySK: 6,
  skByMermaid: 1,
} as const;

export type SkullKingBonusKey = keyof typeof SK_BONUS_MAX;

/** Per-player, per-round entry. Stored serialized in `Score.metadata`. */
export type SkullKingRoundEntry = {
  bid: number;
  tricks: number;
  color14: number;
  black14: number;
  mermaidByPirate: number;
  pirateBySK: number;
  skByMermaid: number;
};

export type SkullKingRoundScore = {
  base: number;
  bonus: number;
  total: number;
};

export const EMPTY_SK_ROUND: SkullKingRoundEntry = {
  bid: 0,
  tricks: 0,
  color14: 0,
  black14: 0,
  mermaidByPirate: 0,
  pirateBySK: 0,
  skByMermaid: 0,
};

export function scoreSkullKingRound(
  round: number,
  entry: SkullKingRoundEntry,
): SkullKingRoundScore {
  const {
    bid,
    tricks,
    color14,
    black14,
    mermaidByPirate,
    pirateBySK,
    skByMermaid,
  } = entry;

  let base: number;
  if (bid === 0) {
    base = tricks === 0 ? 10 * round : -10 * round;
  } else if (bid === tricks) {
    base = 20 * bid;
  } else {
    base = -10 * Math.abs(bid - tricks);
  }

  const bonus =
    color14 * 10 +
    black14 * 20 +
    mermaidByPirate * 20 +
    pirateBySK * 30 +
    skByMermaid * 40;

  return { base, bonus, total: base + bonus };
}

/** Round category key used in the `Score.category` column ("round_1".."round_10"). */
export function roundCategory(round: number): string {
  return `round_${round}`;
}

const ROUND_CATEGORY_RE = /^round_(\d+)$/;

export function parseRoundCategory(category: string): number | null {
  const m = ROUND_CATEGORY_RE.exec(category);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > SKULL_KING_TOTAL_ROUNDS) return null;
  return n;
}

/**
 * Compute cumulative totals from a list of rounds entries (any order, any
 * subset). Missing rounds contribute 0.
 */
export function computeMatchTotals(
  rounds: { round: number; entry: SkullKingRoundEntry }[],
): number {
  let total = 0;
  for (const r of rounds) {
    total += scoreSkullKingRound(r.round, r.entry).total;
  }
  return total;
}

export type SkullKingOutcome =
  | { kind: "winner"; winnerId: string }
  | { kind: "draw"; tied: string[] }
  | { kind: "empty" };

/**
 * Classic Skull King has no formal tiebreaker — equal totals = draw.
 * Mirrors `resolveScoreOutcome` in 7-wonders-duel.ts in shape, minus
 * tiebreaker logic.
 */
export function resolveSkullKingOutcome(
  totals: Record<string, number>,
): SkullKingOutcome {
  const entries = Object.entries(totals);
  if (entries.length === 0) return { kind: "empty" };

  let best = -Infinity;
  for (const [, v] of entries) if (v > best) best = v;
  const top = entries.filter(([, v]) => v === best).map(([id]) => id);

  if (top.length === 1) {
    return { kind: "winner", winnerId: top[0] };
  }
  return { kind: "draw", tied: top };
}

/**
 * Per-round dealer = (round - 1 + dealerStart) % nbPlayers.
 * round is 1-based, position is 0-based.
 */
export function dealerForRound(
  round: number,
  dealerStart: number,
  playerCount: number,
): number {
  if (playerCount <= 0) return 0;
  return (round - 1 + dealerStart) % playerCount;
}
