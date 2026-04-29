import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Phases that have meaningful in-flight state worth persisting. The
 * round-transition + completed + match-start phases derive cleanly from the
 * server data, so they don't need a draft. */
type DraftablePhase = "bidding" | "bid-recap" | "result";

/** Snapshot of the in-flight round, persisted under
 * `Match.metadata.skullKing.draft`. Reset to null when the round is finalized. */
type SkDraft = {
  round: number;
  phase: DraftablePhase;
  bids: Record<string, number>;
  entries: Record<string, SkullKingRoundEntry>;
  activeBidIdx: number;
  activeResultIdx: number;
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

/** How long after a tap we wait before flushing the draft to the server.
 * Short enough that even fast successive inputs (~100ms apart) settle in
 * one save once the user pauses. Phase-transition / End-round flows flush
 * imperatively, so the debounce only needs to cover incremental input. */
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

  const currentRound = Math.min(
    SKULL_KING_TOTAL_ROUNDS,
    lastDoneRound + 1,
  );

  // Hydrate the in-flight round from the persisted draft if it matches the
  // round we're on (a stale draft from a prior round is ignored — End-round
  // would normally clear it, but we guard anyway so divergent server state
  // can't surface old values). Computed every render but only consumed by
  // useState lazy initializers, so the hydration is one-shot per mount.
  const persistedDraft: SkDraft | null =
    skMeta.draft && skMeta.draft.round === currentRound ? skMeta.draft : null;

  // Phase derivation. When the match is COMPLETED, we lock the completed view.
  // Otherwise, if the persisted draft has a phase, resume there.
  const initialPhase: Phase = useMemo(() => {
    if (match.status === "COMPLETED") return "completed";
    if (!skMeta.startedAt) return "match-start";
    if (lastDoneRound >= SKULL_KING_TOTAL_ROUNDS) return "completed";
    if (persistedDraft) return persistedDraft.phase;
    return "bidding";
  }, [match.status, skMeta.startedAt, lastDoneRound, persistedDraft]);

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

  // In-flight round state. Initialized from the persisted draft on mount; the
  // round-change effect below resets it once the user advances rounds.
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
  /** Round we're currently editing (in edit mode) or about to finalize. */
  const activeResultRound = editingRound ?? currentRound;

  // When the round changes (after End-round → server bumps lastDoneRound),
  // clear the in-memory state so the next round starts fresh. Don't reset
  // while editing a previous round — the round-change race after a re-save
  // would clobber the user's still-in-flight edit.
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

  // ── Draft persistence ──────────────────────────────────────────────────
  // Survive a refresh during the bidding / bid-recap / result phases. We
  // serialize the relevant slice of state and PATCH it into
  // match.metadata.skullKing.draft, debounced. The match prop is read via a
  // ref so a server round-trip echoing our just-saved draft doesn't retrigger
  // the effect or merge stale fields back in.
  const matchRef = useRef(match);
  useEffect(() => {
    matchRef.current = match;
  });

  // Track the last serialized draft we sent so we don't re-PATCH identical
  // payloads on benign re-renders.
  const lastSavedDraftRef = useRef<string | null>(
    persistedDraft ? JSON.stringify(persistedDraft) : null,
  );
  // Pending debounce handle — held in a ref so handleEndRound can cancel it
  // before finalizing the round, even when the bursty test clicks would
  // otherwise leave the timer perpetually rescheduled.
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
      phase,
      bids: filteredBids,
      entries,
      activeBidIdx,
      activeResultIdx,
    };
    // Skip trivial drafts — there's nothing recoverable to persist when the
    // user has just entered a fresh round with no input. Avoids a save
    // race at the bidding-phase entry that would otherwise flash "saved"
    // before any real user state is captured.
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
      const latest = matchRef.current;
      const latestMeta = (latest.metadata as Record<string, unknown>) ?? {};
      const latestSk =
        (latestMeta.skullKing as SkMatchMetadata | undefined) ?? {};
      patchMatch.mutate({
        metadata: {
          ...latestMeta,
          skullKing: { ...latestSk, draft },
        },
      });
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
    // patchMatch is a stable mutation handle; omitting it from deps avoids
    // a re-fire every render when react-query re-creates internal refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, bids, entries, activeBidIdx, activeResultIdx, currentRound]);

  /** Wipe the draft from match.metadata. Called unconditionally from
   * End-round so the finalized scores are the source of truth — even on the
   * fast path where the debounced save never fired (rapid input cancelled
   * each timer before it elapsed). */
  const clearDraft = useCallback(async () => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    lastSavedDraftRef.current = null;
    const latest = matchRef.current;
    const latestMeta = (latest.metadata as Record<string, unknown>) ?? {};
    const latestSk =
      (latestMeta.skullKing as SkMatchMetadata | undefined) ?? {};
    await patchMatch.mutateAsync({
      metadata: {
        ...latestMeta,
        skullKing: { ...latestSk, draft: null },
      },
    });
  }, [patchMatch]);

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
      computeCumulativeBefore(
        orderedPlayers,
        persistedEntries,
        activeResultRound,
      ),
    [orderedPlayers, persistedEntries, activeResultRound],
  );

  /** Re-enter the result phase for the round that was just finalized so the
   * scribe can correct a typo. Pre-fills bids + entries from the persisted
   * scores and locks the round number to the one being edited. */
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

    // Build the score payloads.
    const payloads = orderedPlayers.map((p) => {
      const e = entries[p.id] ?? {
        ...EMPTY_SK_ROUND,
        bid: bids[p.id] ?? 0,
      };
      const s = scoreSkullKingRound(targetRound, e);
      return {
        playerId: p.id,
        category: roundCategory(targetRound),
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
    // Clear the persisted draft now that the round is finalized. Done after
    // the score save so a save failure doesn't leave us with a wiped draft
    // and no row to show for it.
    await clearDraft();

    if (isEditing) {
      // Re-saved an earlier round. Drop the editing flag, clear the
      // scratchpad, and bounce back to the transition recap so the user
      // sees the updated standings.
      setEditingRound(null);
      setBids({});
      setEntries({});
      setActiveBidIdx(0);
      setActiveResultIdx(0);
      setPhase("round-transition");
      return;
    }

    if (targetRound >= SKULL_KING_TOTAL_ROUNDS) {
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
    // After End-round the server's scores have been refreshed, so
    // `lastDoneRound` reflects the round we just finalized and `currentRound`
    // is the upcoming round (currentRound = lastDoneRound + 1). Don't add
    // another +1 — that's the off-by-one we used to ship.
    const justFinished = lastDoneRound;
    const next = currentRound;
    const dealerIdxNext = dealerForRound(next, dealerStart, playerCount);
    const nextDealer = orderedPlayers[dealerIdxNext];

    // Standings = totals after the round just played, all sourced from the
    // server. (No need to fall back to in-memory `entries`: the End-round
    // save resolved before this render, so persistedEntries is current.)
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
