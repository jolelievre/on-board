import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { syncEngine } from "../../lib/sync";
import { HandMatchGrid } from "../match/HandMatchGrid";
import type {
  ScoreGridValues,
  SupremacySelection,
} from "../match/HandMatchGrid";
import { WinnerBanner } from "../match/WinnerBanner";
import { displayPlayerName } from "../../../shared/players";
import type { SaveStatus } from "../ui/SyncPill";
import { Button } from "../ui/Button";
import {
  SEVEN_WONDERS_CATEGORY_KEYS,
  computeTotalsByPlayer,
  resolveScoreOutcome,
  type SevenWondersCategoryKey,
  type SevenWondersVictoryType,
} from "../../../shared/scoring/7-wonders-duel";
import type { Match, Player, ScoreRow } from "../../types/match";

const SAVE_DEBOUNCE_MS = 300;
/** How long the "saved" badge lingers before reverting to the idle
 * (just the wifi icon) state. Matches the alias saved-badge timing. */
const SAVED_INDICATOR_MS = 1500;

type CompletedVictoryType = SevenWondersVictoryType | "draw";

type ScorePayload = {
  playerId: string;
  category: SevenWondersCategoryKey;
  value: number;
};

function buildValuesFromScores(
  players: Player[],
  scores: ScoreRow[],
): ScoreGridValues {
  const values: ScoreGridValues = {};
  for (const p of players) values[p.id] = {};
  for (const s of scores) {
    if (
      !(SEVEN_WONDERS_CATEGORY_KEYS as ReadonlyArray<string>).includes(s.category)
    ) {
      continue;
    }
    if (!values[s.playerId]) values[s.playerId] = {};
    values[s.playerId][s.category as SevenWondersCategoryKey] = s.value;
  }
  return values;
}

function valuesToScores(values: ScoreGridValues): ScorePayload[] {
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

type Props = {
  match: Match;
  /** Notifies the parent of save-status changes so it can render the
   * sync pill inside the page Header (rather than inline in the scorer). */
  onSaveStatusChange?: (status: SaveStatus) => void;
};

export function SevenWondersDuelScorer({ match, onSaveStatusChange }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const matchId = match.id;

  const [values, setValues] = useState<ScoreGridValues>(() =>
    buildValuesFromScores(match.players, match.scores),
  );
  const [supremacy, setSupremacy] = useState<SupremacySelection>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRevertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<unknown> | null>(null);

  const clearSavedRevertTimer = () => {
    if (savedRevertTimer.current) {
      clearTimeout(savedRevertTimer.current);
      savedRevertTimer.current = null;
    }
  };

  const isDraft = matchId.startsWith("draft_");

  const applyScoresOptimistically = useCallback(
    (scores: ScorePayload[]) => {
      queryClient.setQueryData<Match>(["matches", matchId], (prev) => {
        if (!prev) return prev;
        const remaining = prev.scores.filter(
          (s) =>
            !scores.some(
              (n) => n.playerId === s.playerId && n.category === s.category,
            ),
        );
        return {
          ...prev,
          scores: [
            ...remaining,
            ...scores.map((s) => ({
              playerId: s.playerId,
              category: s.category,
              value: s.value,
            })),
          ],
        };
      });
    },
    [matchId, queryClient],
  );

  const saveScores = useMutation({
    mutationFn: async (scores: ScorePayload[]) => {
      // Drafts have no server resource yet. Apply optimistically + enqueue
      // for sync; mutateAsync resolves so callers awaiting it (e.g. SK's
      // end-of-round flush) can proceed without try/catch.
      if (isDraft) {
        applyScoresOptimistically(scores);
        await syncEngine.enqueue(
          "PATCH",
          `/api/matches/${matchId}/scores`,
          { scores },
        );
        return null;
      }
      return api(`/api/matches/${matchId}/scores`, {
        method: "PATCH",
        body: JSON.stringify({ scores }),
      });
    },
    onMutate: () => {
      clearSavedRevertTimer();
      setSaveStatus("saving");
    },
    onSuccess: () => {
      clearSavedRevertTimer();
      // Drafts reflect "queued" state until the sync engine replays them.
      if (isDraft) {
        setSaveStatus("offline");
        return;
      }
      setSaveStatus("saved");
      // Briefly show "saved" then return to the idle (wifi-only) state
      // so the header stays calm.
      savedRevertTimer.current = setTimeout(() => {
        setSaveStatus("idle");
        savedRevertTimer.current = null;
      }, SAVED_INDICATOR_MS);
    },
    onError: (err: unknown, scores: ScorePayload[]) => {
      clearSavedRevertTimer();
      // Network failure on a real (non-draft) match — queue for sync on
      // reconnect. Apply the values to the cache so navigation away
      // doesn't lose them.
      if (!(err instanceof ApiError)) {
        applyScoresOptimistically(scores);
        void syncEngine.enqueue("PATCH", `/api/matches/${matchId}/scores`, { scores });
        setSaveStatus("offline");
      } else {
        setSaveStatus("error");
      }
    },
  });

  const flushPendingSave = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
      const scores = valuesToScores(values);
      if (scores.length > 0) {
        pendingSaveRef.current = saveScores.mutateAsync(scores);
      }
    }
    if (pendingSaveRef.current) {
      try {
        await pendingSaveRef.current;
      } catch {
        /* surfaced via saveStatus */
      } finally {
        pendingSaveRef.current = null;
      }
    }
  }, [saveScores, values]);

  const handleScoreChange = useCallback(
    (playerId: string, category: SevenWondersCategoryKey, value: number) => {
      setValues((prev) => {
        const next: ScoreGridValues = {
          ...prev,
          [playerId]: { ...prev[playerId], [category]: value },
        };

        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          debounceTimer.current = null;
          const scores = valuesToScores(next);
          if (scores.length > 0) {
            pendingSaveRef.current = saveScores.mutateAsync(scores);
          }
        }, SAVE_DEBOUNCE_MS);

        return next;
      });
    },
    [saveScores],
  );

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (savedRevertTimer.current) clearTimeout(savedRevertTimer.current);
    };
  }, []);

  // Surface the save status to the parent (the route renders the
  // SyncPill in the Header).
  useEffect(() => {
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus, onSaveStatusChange]);

  const completeMatch = useMutation({
    mutationFn: async (input: {
      victoryType: CompletedVictoryType;
      winnerId: string | null;
    }) => {
      if (isDraft) {
        queryClient.setQueryData<Match>(["matches", matchId], (prev) =>
          prev
            ? {
                ...prev,
                status: "COMPLETED",
                victoryType: input.victoryType,
                winnerId: input.winnerId,
              }
            : prev,
        );
        await syncEngine.enqueue("PUT", `/api/matches/${matchId}`, {
          status: "COMPLETED",
          victoryType: input.victoryType,
          winnerId: input.winnerId,
        });
        return null;
      }
      return api<Match>(`/api/matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify({
          status: "COMPLETED",
          victoryType: input.victoryType,
          winnerId: input.winnerId,
        }),
      });
    },
    onSuccess: (updated) => {
      if (!updated) return;
      queryClient.setQueryData<Match>(["matches", matchId], (prev) =>
        prev ? { ...prev, ...updated } : updated,
      );
      queryClient.invalidateQueries({ queryKey: ["matches"] });
    },
    onError: (
      err: unknown,
      input: { victoryType: CompletedVictoryType; winnerId: string | null },
    ) => {
      if (!(err instanceof ApiError)) {
        // Offline — queue the completion and apply it optimistically.
        void syncEngine.enqueue("PUT", `/api/matches/${matchId}`, {
          status: "COMPLETED",
          victoryType: input.victoryType,
          winnerId: input.winnerId,
        });
        queryClient.setQueryData<Match>(["matches", matchId], (prev) =>
          prev
            ? {
                ...prev,
                status: "COMPLETED",
                victoryType: input.victoryType,
                winnerId: input.winnerId,
              }
            : prev,
        );
      }
    },
  });

  const totals = useMemo(() => {
    const flat = match.players.flatMap((p) =>
      SEVEN_WONDERS_CATEGORY_KEYS.map((cat) => ({
        playerId: p.id,
        category: cat,
        value: values[p.id]?.[cat] ?? 0,
      })),
    );
    return computeTotalsByPlayer(flat);
  }, [match, values]);

  const civilVp = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of match.players) out[p.id] = values[p.id]?.civil ?? 0;
    return out;
  }, [match, values]);

  const outcome = useMemo(
    () => resolveScoreOutcome(totals, civilVp),
    [totals, civilVp],
  );
  const isCompleted = match.status === "COMPLETED";

  const supremacyPlayer = supremacy
    ? (match.players.find((p) => p.id === supremacy.playerId) ?? null)
    : null;
  const supremacyPlayerName = supremacyPlayer
    ? displayPlayerName(supremacyPlayer)
    : "";

  // Display-name-resolved players passed to the score grid. The grid
  // doesn't need to know about User vs Player — we resolve at the edge.
  const displayPlayers = match.players.map((p) => ({
    id: p.id,
    name: displayPlayerName(p),
  }));

  const handleComplete = async () => {
    await flushPendingSave();
    if (supremacy) {
      completeMatch.mutate({
        victoryType: supremacy.type,
        winnerId: supremacy.playerId,
      });
      return;
    }
    if (outcome.kind === "empty") return;
    if (outcome.kind === "draw") {
      completeMatch.mutate({ victoryType: "draw", winnerId: null });
      return;
    }
    completeMatch.mutate({ victoryType: "score", winnerId: outcome.winnerId });
  };

  const winner = match.winnerId
    ? (match.players.find((p) => p.id === match.winnerId) ?? null)
    : null;
  const winnerName = winner ? displayPlayerName(winner) : null;
  const winnerTotal = winner ? (totals[winner.id] ?? 0) : null;
  const loserTotal =
    isCompleted && winner
      ? (match.players
          .filter((p) => p.id !== winner.id)
          .map((p) => totals[p.id] ?? 0)[0] ?? null)
      : null;

  const scoreWinnerName =
    outcome.kind === "winner"
      ? (() => {
          const p = match.players.find((p) => p.id === outcome.winnerId);
          return p ? displayPlayerName(p) : "";
        })()
      : "";

  const completeButtonLabel = (() => {
    if (supremacy && supremacyPlayer) {
      const key =
        supremacy.type === "military_supremacy"
          ? "matches.completeMilitarySupremacy"
          : "matches.completeScientificSupremacy";
      return t(key, { name: supremacyPlayerName });
    }
    if (outcome.kind === "draw") return t("matches.declareDraw");
    if (outcome.kind === "winner") {
      return outcome.viaTiebreaker
        ? t("matches.completeByTiebreaker", { name: scoreWinnerName })
        : t("matches.completeByScore", { name: scoreWinnerName });
    }
    return t("matches.completeByScore", { name: "" });
  })();

  const completeOutcomeAttr = supremacy ? supremacy.type : outcome.kind;

  return (
    <>
      {isCompleted && (
        <WinnerBanner
          winnerName={winnerName}
          winnerScore={winnerTotal}
          loserScore={loserTotal}
          victoryType={match.victoryType}
        />
      )}

      <div className="mt-3">
        <HandMatchGrid
          players={displayPlayers}
          values={values}
          onChange={handleScoreChange}
          supremacy={supremacy}
          onSupremacyChange={setSupremacy}
          disabled={isCompleted}
          winnerId={match.winnerId}
        />
      </div>

      {!isCompleted && (
        <div className="mt-6">
          <Button
            type="button"
            onClick={handleComplete}
            disabled={completeMatch.isPending}
            data-testid="complete-match"
            data-outcome={completeOutcomeAttr}
            variant="primary"
            size="lg"
            fullWidth
          >
            {completeButtonLabel}
          </Button>
        </div>
      )}

      {isCompleted && (
        <Link
          to="/games/$slug"
          params={{ slug: match.game.slug }}
          className="mt-6 block text-center text-sm"
          style={{ color: "var(--color-primary)" }}
          data-testid="back-to-game"
        >
          {t("matches.back")}
        </Link>
      )}
    </>
  );
}
