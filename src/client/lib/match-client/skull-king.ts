import {
  EMPTY_SK_ROUND,
  roundCategory,
  scoreSkullKingRound,
  type SkullKingRoundEntry,
} from "../../../shared/scoring/skull-king";
import type { Match } from "../../types/match";

export type ScorePayload = {
  playerId: string;
  category: string;
  value: number;
  metadata: Record<string, unknown>;
};

/** Build the per-player score payload for a single Skull King round.
 * `entries` may be partial — players without an explicit entry default
 * to a zero round seeded with the player's bid (if known). */
export function buildScorePayload(
  round: number,
  players: { id: string }[],
  bids: Record<string, number | undefined>,
  entries: Record<string, SkullKingRoundEntry>,
): ScorePayload[] {
  return players.map((p) => {
    const e =
      entries[p.id] ??
      ({ ...EMPTY_SK_ROUND, bid: bids[p.id] ?? 0 } as SkullKingRoundEntry);
    const s = scoreSkullKingRound(round, e);
    return {
      playerId: p.id,
      category: roundCategory(round),
      value: s.total,
      metadata: {
        bid: e.bid,
        tricks: e.tricks,
        color14: e.color14,
        black14: e.black14,
        mermaidByPirate: e.mermaidByPirate,
        pirateBySK: e.pirateBySK,
        skByMermaid: e.skByMermaid,
        base: s.base,
        bonus: s.bonus,
      },
    };
  });
}

export type SkDraftPhase = "bidding" | "bid-recap" | "result";

export type SkDraft = {
  round: number;
  phase: SkDraftPhase;
  bids: Record<string, number>;
  entries: Record<string, SkullKingRoundEntry>;
  activeBidIdx: number;
  activeResultIdx: number;
};

/** Build the metadata patch that persists an in-flight Skull King round
 * draft. Pass `draft === null` to clear it on round finalization. */
export function buildPersistDraftPatch(
  match: Match,
  draft: SkDraft | null,
): Record<string, unknown> {
  const meta = (match.metadata as Record<string, unknown>) ?? {};
  const sk = (meta.skullKing as Record<string, unknown> | undefined) ?? {};
  return {
    ...meta,
    skullKing: { ...sk, draft },
  };
}
