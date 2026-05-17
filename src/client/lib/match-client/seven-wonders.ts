import {
  SEVEN_WONDERS_CATEGORY_KEYS,
  type SevenWondersCategoryKey,
} from "../../../shared/scoring/7-wonders-duel";

export type ScoreGridValues = Record<
  string,
  Partial<Record<SevenWondersCategoryKey, number>>
>;

export type ScorePayload = {
  playerId: string;
  category: SevenWondersCategoryKey;
  value: number;
};

/** Flatten a per-player grid of category values into the payload shape
 * accepted by `upsertScores` and PATCH /api/matches/:id/scores. Skips
 * cells the user has not filled in. */
export function buildScorePayload(values: ScoreGridValues): ScorePayload[] {
  const out: ScorePayload[] = [];
  for (const playerId of Object.keys(values)) {
    for (const cat of SEVEN_WONDERS_CATEGORY_KEYS) {
      const v = values[playerId]?.[cat];
      if (v === undefined) continue;
      out.push({ playerId, category: cat, value: v });
    }
  }
  return out;
}
