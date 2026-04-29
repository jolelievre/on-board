import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { HandMatchGrid } from "../match/HandMatchGrid";
import type {
  ScoreGridValues,
  SupremacySelection,
} from "../match/HandMatchGrid";
import { MatchTitleBar } from "../match/MatchTitleBar";
import { WinnerBanner } from "../match/WinnerBanner";
import { SyncPill, type SyncState } from "../ui/SyncPill";
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

type CompletedVictoryType = SevenWondersVictoryType | "draw";
type SaveStatus = "idle" | "saving" | "saved" | "error";

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

function saveStatusToSyncState(status: SaveStatus): SyncState {
  switch (status) {
    case "idle":
      return "idle";
    case "saving":
      return "saving";
    case "saved":
      return "saved";
    case "error":
      return "error";
  }
}

type Props = { match: Match };

export function SevenWondersDuelScorer({ match }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const matchId = match.id;

  const [values, setValues] = useState<ScoreGridValues>(() =>
    buildValuesFromScores(match.players, match.scores),
  );
  const [supremacy, setSupremacy] = useState<SupremacySelection>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<unknown> | null>(null);

  const saveScores = useMutation({
    mutationFn: (scores: ScorePayload[]) =>
      api(`/api/matches/${matchId}/scores`, {
        method: "PATCH",
        body: JSON.stringify({ scores }),
      }),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => setSaveStatus("saved"),
    onError: () => setSaveStatus("error"),
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
    };
  }, []);

  const completeMatch = useMutation({
    mutationFn: (input: {
      victoryType: CompletedVictoryType;
      winnerId: string | null;
    }) =>
      api<Match>(`/api/matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify({
          status: "COMPLETED",
          victoryType: input.victoryType,
          winnerId: input.winnerId,
        }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Match>(["matches", matchId], (prev) =>
        prev ? { ...prev, ...updated } : updated,
      );
      queryClient.invalidateQueries({ queryKey: ["matches"] });
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
  const winnerTotal = winner ? (totals[winner.id] ?? 0) : null;
  const loserTotal =
    isCompleted && winner
      ? (match.players
          .filter((p) => p.id !== winner.id)
          .map((p) => totals[p.id] ?? 0)[0] ?? null)
      : null;

  const scoreWinnerName =
    outcome.kind === "winner"
      ? (match.players.find((p) => p.id === outcome.winnerId)?.name ?? "")
      : "";

  const completeButtonLabel = (() => {
    if (supremacy && supremacyPlayer) {
      const key =
        supremacy.type === "military_supremacy"
          ? "matches.completeMilitarySupremacy"
          : "matches.completeScientificSupremacy";
      return t(key, { name: supremacyPlayer.name });
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
  const titleText = isCompleted
    ? t("matches.completed", { defaultValue: "Match done!" })
    : t("matches.title");

  return (
    <>
      <MatchTitleBar
        title={titleText}
        underlineWidth={isCompleted ? 200 : 130}
        right={
          !isCompleted && (
            <SyncPill
              state={saveStatusToSyncState(saveStatus)}
              data-testid="save-status"
              data-status={saveStatus}
            />
          )
        }
      />

      {isCompleted && (
        <WinnerBanner
          winnerName={winner?.name ?? null}
          winnerScore={winnerTotal}
          loserScore={loserTotal}
          victoryType={match.victoryType}
        />
      )}

      <div className="mt-3">
        <HandMatchGrid
          players={match.players}
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
