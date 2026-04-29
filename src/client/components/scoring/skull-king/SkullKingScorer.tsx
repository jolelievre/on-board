import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import {
  EMPTY_SK_ROUND,
  SKULL_KING_TOTAL_ROUNDS,
  dealerForRound,
  parseRoundCategory,
  resolveSkullKingOutcome,
  roundCategory,
  scoreSkullKingRound,
  type SkullKingRoundEntry,
} from "../../../../shared/scoring/skull-king";
import type { Match, Player } from "../../../types/match";
import type { SaveStatus } from "../../ui/SyncPill";
import { MatchStartScreen } from "./MatchStartScreen";
import { BiddingScreen } from "./BiddingScreen";
import { BidRecapScreen } from "./BidRecapScreen";
import { RoundResultScreen } from "./RoundResultScreen";
import { RoundTransitionScreen } from "./RoundTransitionScreen";
import { ScoreboardScreen } from "./ScoreboardScreen";
import { MatchCompleteScreen } from "./MatchCompleteScreen";

type Phase =
  | "match-start"
  | "bidding"
  | "bid-recap"
  | "result"
  | "round-transition"
  | "completed";

type Props = {
  match: Match;
  scoreboardOpen: boolean;
  onScoreboardClose: () => void;
  onSaveStatusChange?: (status: SaveStatus) => void;
};

const SAVED_INDICATOR_MS = 1500;

type SkMatchMetadata = {
  dealerStart?: number;
  startedAt?: string;
};

function readSkMetadata(match: Match): SkMatchMetadata {
  const meta = match.metadata as { skullKing?: SkMatchMetadata } | undefined;
  return meta?.skullKing ?? {};
}

/** Build the per-round, per-player entry map from server score rows. */
function buildEntriesFromScores(
  match: Match,
): Record<string, Record<number, SkullKingRoundEntry | undefined>> {
  const out: Record<string, Record<number, SkullKingRoundEntry | undefined>> = {};
  for (const p of match.players) out[p.id] = {};
  for (const s of match.scores) {
    const round = parseRoundCategory(s.category);
    if (!round) continue;
    const md = (s.metadata ?? {}) as Partial<SkullKingRoundEntry>;
    out[s.playerId] = out[s.playerId] ?? {};
    out[s.playerId][round] = {
      bid: md.bid ?? 0,
      tricks: md.tricks ?? 0,
      color14: md.color14 ?? 0,
      black14: md.black14 ?? 0,
      mermaidByPirate: md.mermaidByPirate ?? 0,
      pirateBySK: md.pirateBySK ?? 0,
      skByMermaid: md.skByMermaid ?? 0,
    };
  }
  return out;
}

/** Highest round (1..10) where every player has a Score row. */
function lastFullyRecordedRound(
  match: Match,
  entries: ReturnType<typeof buildEntriesFromScores>,
): number {
  for (let r = SKULL_KING_TOTAL_ROUNDS; r >= 1; r--) {
    if (match.players.every((p) => entries[p.id]?.[r])) return r;
  }
  return 0;
}

function computeCumulativeBefore(
  players: Player[],
  entries: ReturnType<typeof buildEntriesFromScores>,
  upToButNotIncluding: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of players) {
    let sum = 0;
    for (let r = 1; r < upToButNotIncluding; r++) {
      const e = entries[p.id]?.[r];
      if (e) sum += scoreSkullKingRound(r, e).total;
    }
    out[p.id] = sum;
  }
  return out;
}

export function SkullKingScorer({
  match,
  scoreboardOpen,
  onScoreboardClose,
  onSaveStatusChange,
}: Props) {
  const queryClient = useQueryClient();

  // Server-derived state.
  const persistedEntries = useMemo(() => buildEntriesFromScores(match), [match]);
  const lastDoneRound = useMemo(
    () => lastFullyRecordedRound(match, persistedEntries),
    [match, persistedEntries],
  );
  const skMeta = readSkMetadata(match);
  const playerCount = match.players.length;

  // Match-start state — local copies so the user can edit before persisting.
  const [dealerStart, setDealerStart] = useState<number>(
    typeof skMeta.dealerStart === "number" ? skMeta.dealerStart : 0,
  );
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    match.players.map((p) => p.id),
  );

  useEffect(() => {
    setOrderedIds(match.players.map((p) => p.id));
  }, [match.players]);

  // Keep dealerStart in sync when the persisted match data refreshes.
  useEffect(() => {
    if (typeof skMeta.dealerStart === "number") {
      setDealerStart(skMeta.dealerStart);
    }
  }, [skMeta.dealerStart]);

  const orderedPlayers = useMemo(() => {
    // Use orderedIds to project; fall back to match.players if any id missing.
    const byId = new Map(match.players.map((p) => [p.id, p]));
    const out: Player[] = [];
    for (const id of orderedIds) {
      const p = byId.get(id);
      if (p) out.push(p);
    }
    if (out.length !== match.players.length) return match.players;
    return out;
  }, [match.players, orderedIds]);

  // Phase derivation. When the match is COMPLETED, we lock the completed view.
  const initialPhase: Phase = useMemo(() => {
    if (match.status === "COMPLETED") return "completed";
    if (!skMeta.startedAt) return "match-start";
    if (lastDoneRound >= SKULL_KING_TOTAL_ROUNDS) return "completed";
    return "bidding";
  }, [match.status, skMeta.startedAt, lastDoneRound]);

  const [phase, setPhase] = useState<Phase>(initialPhase);
  // When the match data changes (e.g. after a save round-trips), realign the
  // phase. We only auto-advance forward — never backwards into match-start
  // once the user has begun.
  useEffect(() => {
    setPhase((prev) => {
      if (initialPhase === "completed") return "completed";
      if (prev === "match-start" && initialPhase !== "match-start") {
        return "bidding";
      }
      return prev;
    });
  }, [initialPhase]);

  const currentRound = Math.min(
    SKULL_KING_TOTAL_ROUNDS,
    lastDoneRound + 1,
  );

  // In-memory drafts for the current round (cleared after End-round).
  const [bids, setBids] = useState<Record<string, number | undefined>>({});
  const [entries, setEntries] = useState<Record<string, SkullKingRoundEntry>>({});
  const [activeBidIdx, setActiveBidIdx] = useState(0);
  const [activeResultIdx, setActiveResultIdx] = useState(0);

  // Reset the in-memory state when the round changes (e.g. after End-round).
  useEffect(() => {
    setBids({});
    setEntries({});
    setActiveBidIdx(0);
    setActiveResultIdx(0);
  }, [currentRound]);

  // ── Save plumbing ──────────────────────────────────────────────────────

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  useEffect(() => {
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus, onSaveStatusChange]);

  const flashSaved = useCallback(() => {
    setSaveStatus("saved");
    const t = window.setTimeout(() => setSaveStatus("idle"), SAVED_INDICATOR_MS);
    return () => window.clearTimeout(t);
  }, []);

  const patchMatch = useMutation({
    mutationFn: (input: {
      metadata?: Record<string, unknown>;
      playerOrder?: { playerId: string; position: number }[];
    }) =>
      api<Match>(`/api/matches/${match.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: (updated) => {
      queryClient.setQueryData<Match>(["matches", match.id], (prev) =>
        prev ? { ...prev, ...updated } : updated,
      );
      flashSaved();
    },
    onError: () => setSaveStatus("error"),
  });

  const saveScores = useMutation({
    mutationFn: (
      scores: {
        playerId: string;
        category: string;
        value: number;
        metadata: Record<string, unknown>;
      }[],
    ) =>
      api(`/api/matches/${match.id}/scores`, {
        method: "PATCH",
        body: JSON.stringify({ scores }),
      }),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches", match.id] });
      flashSaved();
    },
    onError: () => setSaveStatus("error"),
  });

  const completeMatch = useMutation({
    mutationFn: (input: {
      victoryType: "score" | "draw";
      winnerId: string | null;
    }) =>
      api<Match>(`/api/matches/${match.id}`, {
        method: "PUT",
        body: JSON.stringify({
          status: "COMPLETED",
          victoryType: input.victoryType,
          winnerId: input.winnerId,
        }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Match>(["matches", match.id], (prev) =>
        prev ? { ...prev, ...updated } : updated,
      );
      queryClient.invalidateQueries({ queryKey: ["matches"] });
    },
  });

  // ── Phase handlers ─────────────────────────────────────────────────────

  const handleStart = async () => {
    const newMeta = {
      ...((match.metadata as Record<string, unknown>) ?? {}),
      skullKing: {
        ...skMeta,
        dealerStart,
        startedAt: new Date().toISOString(),
      },
    };
    const playerOrder = orderedIds.map((playerId, position) => ({
      playerId,
      position,
    }));
    await patchMatch.mutateAsync({ metadata: newMeta, playerOrder });
    setPhase("bidding");
    setActiveBidIdx(0);
  };

  const handleReveal = () => setPhase("bid-recap");
  const handleBackToBids = () => setPhase("bidding");
  const handleEnterResults = () => {
    // Seed entries with bids so each player's row has the right bid baked in.
    const seeded: Record<string, SkullKingRoundEntry> = {};
    for (const p of orderedPlayers) {
      seeded[p.id] = {
        ...EMPTY_SK_ROUND,
        bid: bids[p.id] ?? 0,
      };
    }
    setEntries(seeded);
    setActiveResultIdx(0);
    setPhase("result");
  };

  const handleResultEntry = (playerId: string, entry: SkullKingRoundEntry) => {
    setEntries((prev) => ({ ...prev, [playerId]: entry }));
  };

  const cumulativeBefore = useMemo(
    () =>
      computeCumulativeBefore(orderedPlayers, persistedEntries, currentRound),
    [orderedPlayers, persistedEntries, currentRound],
  );

  const handleEndRound = async () => {
    // Build the score payloads.
    const payloads = orderedPlayers.map((p) => {
      const e = entries[p.id] ?? {
        ...EMPTY_SK_ROUND,
        bid: bids[p.id] ?? 0,
      };
      const s = scoreSkullKingRound(currentRound, e);
      return {
        playerId: p.id,
        category: roundCategory(currentRound),
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

    await saveScores.mutateAsync(payloads);

    if (currentRound >= SKULL_KING_TOTAL_ROUNDS) {
      // Compute totals from the freshly persisted history (saved scores
      // round-trip via the invalidation; we duplicate the math here so the
      // completion call doesn't race the refetch).
      const totals: Record<string, number> = {};
      for (const p of orderedPlayers) {
        let sum = 0;
        for (let r = 1; r < SKULL_KING_TOTAL_ROUNDS; r++) {
          const e = persistedEntries[p.id]?.[r];
          if (e) sum += scoreSkullKingRound(r, e).total;
        }
        sum += payloads.find((x) => x.playerId === p.id)?.value ?? 0;
        totals[p.id] = sum;
      }
      const outcome = resolveSkullKingOutcome(totals);
      if (outcome.kind === "winner") {
        await completeMatch.mutateAsync({
          victoryType: "score",
          winnerId: outcome.winnerId,
        });
      } else if (outcome.kind === "draw") {
        await completeMatch.mutateAsync({
          victoryType: "draw",
          winnerId: null,
        });
      }
      setPhase("completed");
    } else {
      setPhase("round-transition");
    }
  };

  const handleTransitionContinue = () => {
    setPhase("bidding");
    setActiveBidIdx(0);
  };

  // ── Header / scoreboard overlay ────────────────────────────────────────

  if (scoreboardOpen) {
    // Scoreboard shows ALL persisted entries plus, if we're mid-result, the
    // in-memory entries for the current round so the user can compare.
    const merged: Record<
      string,
      Record<number, SkullKingRoundEntry | undefined>
    > = {};
    for (const p of orderedPlayers) {
      merged[p.id] = { ...persistedEntries[p.id] };
    }
    return (
      <>
        <ScoreboardScreen
          players={orderedPlayers}
          entries={merged}
          currentRound={currentRound}
        />
        <div style={{ padding: "12px 16px 16px" }}>
          <button
            type="button"
            onClick={onScoreboardClose}
            data-testid="sk-scoreboard-close"
            style={{
              background: "var(--color-surface-alt)",
              color: "var(--color-ink)",
              border: "1px solid var(--color-border)",
              fontFamily: "var(--font-body)",
              fontWeight: 600,
              fontSize: "1rem",
              padding: "12px 18px",
              borderRadius: 12,
              cursor: "pointer",
              width: "100%",
            }}
          >
            ← Close
          </button>
        </div>
      </>
    );
  }

  // ── Phase render ───────────────────────────────────────────────────────

  if (phase === "match-start") {
    return (
      <MatchStartScreen
        players={orderedPlayers}
        dealerStart={dealerStart}
        onDealerChange={setDealerStart}
        onReorder={(ids) => setOrderedIds(ids)}
        onStart={handleStart}
        disabled={patchMatch.isPending}
      />
    );
  }

  if (phase === "completed") {
    const totals: Record<string, number> = {};
    for (const p of orderedPlayers) {
      let sum = 0;
      for (let r = 1; r <= SKULL_KING_TOTAL_ROUNDS; r++) {
        const e = persistedEntries[p.id]?.[r];
        if (e) sum += scoreSkullKingRound(r, e).total;
      }
      totals[p.id] = sum;
    }
    const outcome = resolveSkullKingOutcome(totals);
    const winner =
      outcome.kind === "winner"
        ? (orderedPlayers.find((p) => p.id === outcome.winnerId) ?? null)
        : null;
    return (
      <MatchCompleteScreen
        players={orderedPlayers}
        totals={totals}
        winner={winner}
        isDraw={outcome.kind === "draw"}
        gameSlug={match.game.slug}
        roundsPlayed={lastDoneRound}
      />
    );
  }

  if (phase === "bidding") {
    return (
      <BiddingScreen
        round={currentRound}
        players={orderedPlayers}
        bids={bids}
        activeIndex={activeBidIdx}
        onActiveIndexChange={setActiveBidIdx}
        onBid={(playerId, value) =>
          setBids((prev) => ({ ...prev, [playerId]: value }))
        }
        onReveal={handleReveal}
      />
    );
  }

  if (phase === "bid-recap") {
    return (
      <BidRecapScreen
        round={currentRound}
        players={orderedPlayers}
        bids={bids}
        onContinue={handleEnterResults}
        onBack={handleBackToBids}
      />
    );
  }

  if (phase === "result") {
    return (
      <RoundResultScreen
        round={currentRound}
        players={orderedPlayers}
        bids={bids}
        entries={entries}
        cumulativeBefore={cumulativeBefore}
        activeIndex={activeResultIdx}
        onActiveIndexChange={setActiveResultIdx}
        onChange={handleResultEntry}
        onSubmit={handleEndRound}
      />
    );
  }

  if (phase === "round-transition") {
    const justFinished = currentRound;
    const next = justFinished + 1;
    const dealerIdxNext = dealerForRound(next, dealerStart, playerCount);
    const nextDealer = orderedPlayers[dealerIdxNext];

    // Standings = totals after the round just played.
    const totals: Record<string, number> = {};
    const lastDeltas: Record<string, number> = {};
    for (const p of orderedPlayers) {
      let sum = 0;
      let last = 0;
      for (let r = 1; r <= justFinished; r++) {
        const e =
          r === justFinished
            ? entries[p.id]
            : persistedEntries[p.id]?.[r];
        if (!e) continue;
        const s = scoreSkullKingRound(r, e).total;
        sum += s;
        if (r === justFinished) last = s;
      }
      totals[p.id] = sum;
      lastDeltas[p.id] = last;
    }
    const standings = orderedPlayers
      .map((player) => ({
        player,
        total: totals[player.id] ?? 0,
        lastDelta: lastDeltas[player.id] ?? 0,
      }))
      .sort((a, b) => b.total - a.total);

    return (
      <RoundTransitionScreen
        completedRound={justFinished}
        nextRound={next}
        nextDealer={nextDealer}
        standings={standings}
        onContinue={handleTransitionContinue}
      />
    );
  }

  return null;
}
