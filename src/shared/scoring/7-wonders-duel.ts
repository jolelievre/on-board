export type SevenWondersCategoryKey =
  | "military"
  | "treasury"
  | "wonders"
  | "civil"
  | "scientific"
  | "commercial"
  | "guilds";

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
  { key: "military", color: "#dc2626", min: 0, max: 9 },
  { key: "treasury", color: "#ca8a04", min: 0 },
  { key: "wonders", color: "#7c3aed", min: 0 },
  { key: "civil", color: "#2563eb", min: 0 },
  { key: "scientific", color: "#16a34a", min: 0 },
  { key: "commercial", color: "#ea580c", min: 0 },
  { key: "guilds", color: "#9333ea", min: 0 },
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

function isSevenWondersCategory(key: string): key is SevenWondersCategoryKey {
  return (SEVEN_WONDERS_CATEGORY_KEYS as ReadonlyArray<string>).includes(key);
}
