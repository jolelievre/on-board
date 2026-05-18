import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  patchMatch,
  upsertScores,
  completeMatch,
} from "../../../lib/mutations";
import {
  buildScorePayload,
  buildPersistDraftPatch,
  type SkDraft,
  type SkDraftPhase,
} from "../../../lib/match-client/skull-king";
import {
  EMPTY_SK_ROUND,
  SKULL_KING_TOTAL_ROUNDS,
  dealerForRound,
  parseRoundCategory,
  resolveSkullKingOutcome,
  scoreSkullKingRound,
  type SkullKingRoundEntry,
} from "../../../../shared/scoring/skull-king";
import type { Match, Player } from "../../../types/match";
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
  onScoreboardOpen: () => void;
  onScoreboardClose: () => void;
};

type SkMatchMetadata = {
  dealerStart?: number;
  startedAt?: string;
  draft?: SkDraft | null;
};

function readSkMetadata(match: Match): SkMatchMetadata {
  const meta = match.metadata as { skullKing?: SkMatchMetadata } | undefined;
  return meta?.skullKing ?? {};
}

/** How long after a tap we wait before flushing the draft. Short enough
 * that even fast successive inputs (~100ms apart) settle in one save
 * once the user pauses. */
const DRAFT_DEBOUNCE_MS = 200;

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
  onScoreboardOpen,
  onScoreboardClose,
}: Props) {
  // Server-derived state.
  const persistedEntries = useMemo(() => buildEntriesFromScores(match), [match]);
  const lastDoneRound = useMemo(
    () => lastFullyRecordedRound(match, persistedEntries),
    [match, persistedEntries],
  );
  const skMeta = readSkMetadata(match);
  const playerCount = match.players.length;

  const [dealerStart, setDealerStart] = useState<number>(
    typeof skMeta.dealerStart === "number" ? skMeta.dealerStart : 0,
  );
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    match.players.map((p) => p.id),
  );

  useEffect(() => {
    setOrderedIds(match.players.map((p) => p.id));
  }, [match.players]);

  useEffect(() => {
    if (typeof skMeta.dealerStart === "number") {
      setDealerStart(skMeta.dealerStart);
    }
  }, [skMeta.dealerStart]);

  const orderedPlayers = useMemo(() => {
    // Project match.players through orderedIds. If any id is missing from
    // orderedIds (drift between server and local state) fall back to the
    // canonical match.players order rather than rendering a truncated list.
    const byId = new Map(match.players.map((p) => [p.id, p]));
    const out: Player[] = [];
    for (const id of orderedIds) {
      const p = byId.get(id);
      if (p) out.push(p);
    }
    if (out.length !== match.players.length) return match.players;
    return out;
  }, [match.players, orderedIds]);

  const currentRound = Math.min(
    SKULL_KING_TOTAL_ROUNDS,
    lastDoneRound + 1,
  );

  // Resume from the persisted draft only when it belongs to the round we're
  // about to play. A stale draft from a prior round is ignored — End-round
  // normally clears it, but we guard anyway so divergent server state can't
  // surface old values into the new round.
  const persistedDraft: SkDraft | null =
    skMeta.draft && skMeta.draft.round === currentRound ? skMeta.draft : null;

  const initialPhase: Phase = useMemo(() => {
    if (match.status === "COMPLETED") return "completed";
    if (!skMeta.startedAt) return "match-start";
    if (lastDoneRound >= SKULL_KING_TOTAL_ROUNDS) return "completed";
    if (persistedDraft) return persistedDraft.phase;
    return "bidding";
  }, [match.status, skMeta.startedAt, lastDoneRound, persistedDraft]);

  const [phase, setPhase] = useState<Phase>(initialPhase);
  // Realign the phase when the match data changes (e.g. after a save round-
  // trips). We only auto-advance forward — never backwards into match-start
  // once the user has begun — to avoid clobbering an in-flight bidding screen.
  useEffect(() => {
    setPhase((prev) => {
      if (initialPhase === "completed") return "completed";
      if (prev === "match-start" && initialPhase !== "match-start") {
        return "bidding";
      }
      return prev;
    });
  }, [initialPhase]);

  // In-flight round state. Initialized from the persisted draft on mount;
  // the round-change effect below resets it once the user advances rounds.
  const [bids, setBids] = useState<Record<string, number | undefined>>(
    () => persistedDraft?.bids ?? {},
  );
  const [entries, setEntries] = useState<Record<string, SkullKingRoundEntry>>(
    () => persistedDraft?.entries ?? {},
  );
  const [activeBidIdx, setActiveBidIdx] = useState(
    () => persistedDraft?.activeBidIdx ?? 0,
  );
  const [activeResultIdx, setActiveResultIdx] = useState(
    () => persistedDraft?.activeResultIdx ?? 0,
  );
  // Set when the user opens "Edit round N" from the round-transition screen.
  // While non-null, the result screen renders for that round and End-round
  // upserts back to its row instead of progressing to a new round.
  const [editingRound, setEditingRound] = useState<number | null>(null);
  const activeResultRound = editingRound ?? currentRound;

  // When currentRound changes (server bumps lastDoneRound after End-round),
  // clear in-memory state so the next round starts fresh. Skip the reset
  // while editing a previous round — the round-change race after a re-save
  // would otherwise clobber the user's still-in-flight edit.
  const previousRoundRef = useRef(currentRound);
  useEffect(() => {
    if (previousRoundRef.current === currentRound) return;
    previousRoundRef.current = currentRound;
    if (editingRound !== null) return;
    setBids({});
    setEntries({});
    setActiveBidIdx(0);
    setActiveResultIdx(0);
  }, [currentRound, editingRound]);

  // ── Draft persistence ──────────────────────────────────────────────────

  const matchRef = useRef(match);
  useEffect(() => {
    matchRef.current = match;
  });

  const lastSavedDraftRef = useRef<string | null>(
    persistedDraft ? JSON.stringify(persistedDraft) : null,
  );
  const draftTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      phase !== "bidding" &&
      phase !== "bid-recap" &&
      phase !== "result"
    ) {
      return;
    }

    const filteredBids: Record<string, number> = {};
    for (const [k, v] of Object.entries(bids)) {
      if (typeof v === "number") filteredBids[k] = v;
    }
    const draft: SkDraft = {
      round: currentRound,
      phase: phase as SkDraftPhase,
      bids: filteredBids,
      entries,
      activeBidIdx,
      activeResultIdx,
    };
    // Skip trivial drafts — there's nothing recoverable to persist when the
    // user has just entered a fresh round with no input.
    const isTrivial =
      phase === "bidding" &&
      Object.keys(filteredBids).length === 0 &&
      Object.keys(entries).length === 0 &&
      activeBidIdx === 0 &&
      activeResultIdx === 0;
    if (isTrivial) return;

    const serialized = JSON.stringify(draft);
    if (lastSavedDraftRef.current === serialized) return;

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      lastSavedDraftRef.current = serialized;
      void patchMatch({
        matchId: matchRef.current.id,
        metadata: buildPersistDraftPatch(matchRef.current, draft),
      });
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [phase, bids, entries, activeBidIdx, activeResultIdx, currentRound]);

  /** Wipe the draft from match.metadata. Called unconditionally from
   * End-round so the finalized scores are the source of truth — even on the
   * fast path where the debounced save never fired. */
  const clearDraft = useCallback(async () => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    lastSavedDraftRef.current = null;
    await patchMatch({
      matchId: matchRef.current.id,
      metadata: buildPersistDraftPatch(matchRef.current, null),
    });
  }, []);

  // ── Phase handlers ─────────────────────────────────────────────────────

  const [starting, setStarting] = useState(false);
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
    setStarting(true);
    try {
      await patchMatch({
        matchId: match.id,
        metadata: newMeta,
        playerOrder,
      });
      setPhase("bidding");
      setActiveBidIdx(0);
    } finally {
      setStarting(false);
    }
  };

  const handleReveal = () => setPhase("bid-recap");
  const handleBackToBids = () => setPhase("bidding");
  const handleEnterResults = () => {
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
      computeCumulativeBefore(
        orderedPlayers,
        persistedEntries,
        activeResultRound,
      ),
    [orderedPlayers, persistedEntries, activeResultRound],
  );

  const handleEditLastRound = () => {
    if (lastDoneRound < 1) return;
    const target = lastDoneRound;
    const reloadedBids: Record<string, number | undefined> = {};
    const reloadedEntries: Record<string, SkullKingRoundEntry> = {};
    for (const p of orderedPlayers) {
      const e = persistedEntries[p.id]?.[target];
      if (e) {
        reloadedEntries[p.id] = e;
        reloadedBids[p.id] = e.bid;
      }
    }
    setBids(reloadedBids);
    setEntries(reloadedEntries);
    setActiveResultIdx(0);
    setEditingRound(target);
    setPhase("result");
  };

  const handleEndRound = async () => {
    const targetRound = activeResultRound;
    const isEditing = editingRound !== null;

    const payloads = buildScorePayload(
      targetRound,
      orderedPlayers,
      bids,
      entries,
    );

    await upsertScores({ matchId: match.id, scores: payloads });
    await clearDraft();

    if (isEditing) {
      setEditingRound(null);
      setBids({});
      setEntries({});
      setActiveBidIdx(0);
      setActiveResultIdx(0);
      setPhase("round-transition");
      return;
    }

    if (targetRound >= SKULL_KING_TOTAL_ROUNDS) {
      // Compute totals from the freshly persisted history merged with
      // the round we just saved (the merge keeps the completion call
      // from racing the next render).
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
        await completeMatch({
          matchId: match.id,
          victoryType: "score",
          winnerId: outcome.winnerId,
        });
      } else if (outcome.kind === "draw") {
        await completeMatch({
          matchId: match.id,
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
        disabled={starting}
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
        matchId={match.id}
        roundsPlayed={lastDoneRound}
        onOpenScoreboard={onScoreboardOpen}
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
        round={activeResultRound}
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
    const justFinished = lastDoneRound;
    const next = currentRound;
    const dealerIdxNext = dealerForRound(next, dealerStart, playerCount);
    const nextDealer = orderedPlayers[dealerIdxNext];

    const totals: Record<string, number> = {};
    const lastDeltas: Record<string, number> = {};
    for (const p of orderedPlayers) {
      let sum = 0;
      let last = 0;
      for (let r = 1; r <= justFinished; r++) {
        const e = persistedEntries[p.id]?.[r];
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
        onEditLastRound={handleEditLastRound}
      />
    );
  }

  return null;
}
