export type SevenWondersCategoryKey =
  | "civil"
  | "scientific"
  | "commercial"
  | "guilds"
  | "wonders"
  | "scientific_progress"
  | "treasury"
  | "military";

export type SevenWondersVictoryType =
  | "score"
  | "military_supremacy"
  | "scientific_supremacy";

export type SevenWondersCategory = {
  key: SevenWondersCategoryKey;
  color: string;
  min?: number;
  max?: number;
};

export const SEVEN_WONDERS_CATEGORIES: ReadonlyArray<SevenWondersCategory> = [
  { key: "civil", color: "#2563eb", min: 0 },
  { key: "scientific", color: "#16a34a", min: 0 },
  { key: "commercial", color: "#eab308", min: 0 },
  { key: "guilds", color: "#9333ea", min: 0 },
  { key: "wonders", color: "#9ca3af", min: 0 },
  { key: "scientific_progress", color: "#84cc16", min: 0 },
  { key: "treasury", color: "#ca8a04", min: 0 },
  { key: "military", color: "#dc2626", min: 0, max: 10 },
];

export const SEVEN_WONDERS_CATEGORY_KEYS: ReadonlyArray<SevenWondersCategoryKey> =
  SEVEN_WONDERS_CATEGORIES.map((c) => c.key);

export type ScoreEntry = {
  category: SevenWondersCategoryKey;
  value: number;
};

/**
 * Treasury stores raw coins; 1 VP per 3 coins. All other categories store VP directly.
 */
export function categoryToVictoryPoints(
  category: SevenWondersCategoryKey,
  value: number,
): number {
  if (category === "treasury") {
    return Math.floor(Math.max(0, value) / 3);
  }
  return value;
}

export function computePlayerTotal(scores: ScoreEntry[]): number {
  return scores.reduce(
    (sum, s) => sum + categoryToVictoryPoints(s.category, s.value),
    0,
  );
}

export function computeTotalsByPlayer(
  scores: { playerId: string; category: string; value: number }[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of scores) {
    if (!isSevenWondersCategory(s.category)) continue;
    totals[s.playerId] =
      (totals[s.playerId] ?? 0) + categoryToVictoryPoints(s.category, s.value);
  }
  return totals;
}

/**
 * Returns the playerId with the highest total, or null on a tie / empty input.
 */
export function computeScoreWinner(
  totals: Record<string, number>,
): string | null {
  const entries = Object.entries(totals);
  if (entries.length === 0) return null;
  let bestId: string | null = null;
  let bestVal = -Infinity;
  let tied = false;
  for (const [id, val] of entries) {
    if (val > bestVal) {
      bestVal = val;
      bestId = id;
      tied = false;
    } else if (val === bestVal) {
      tied = true;
    }
  }
  return tied ? null : bestId;
}

export type ScoreOutcome =
  | { kind: "winner"; winnerId: string; viaTiebreaker: boolean }
  | { kind: "draw" }
  | { kind: "empty" };

/**
 * Applies the official 7 Wonders Duel civil-victory rule:
 * highest total VP → most Civil (blue) VP among the tied players → draw.
 *
 * `civilVp` maps playerId to its civil-category value (which is direct VP).
 */
export function resolveScoreOutcome(
  totals: Record<string, number>,
  civilVp: Record<string, number>,
): ScoreOutcome {
  const entries = Object.entries(totals);
  if (entries.length === 0) return { kind: "empty" };

  let bestVp = -Infinity;
  for (const [, val] of entries) if (val > bestVp) bestVp = val;
  const topByVp = entries.filter(([, val]) => val === bestVp).map(([id]) => id);

  if (topByVp.length === 1) {
    return { kind: "winner", winnerId: topByVp[0], viaTiebreaker: false };
  }

  let bestCivil = -Infinity;
  for (const id of topByVp) {
    const c = civilVp[id] ?? 0;
    if (c > bestCivil) bestCivil = c;
  }
  const topByCivil = topByVp.filter((id) => (civilVp[id] ?? 0) === bestCivil);

  if (topByCivil.length === 1) {
    return { kind: "winner", winnerId: topByCivil[0], viaTiebreaker: true };
  }
  return { kind: "draw" };
}

function isSevenWondersCategory(key: string): key is SevenWondersCategoryKey {
  return (SEVEN_WONDERS_CATEGORY_KEYS as ReadonlyArray<string>).includes(key);
}
