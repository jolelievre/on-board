import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { upsertScores, completeMatch } from "../../lib/mutations";
import { buildScorePayload } from "../../lib/match-client/seven-wonders";
import { HandMatchGrid } from "../match/HandMatchGrid";
import type {
  ScoreGridValues,
  SupremacySelection,
} from "../match/HandMatchGrid";
import { WinnerBanner } from "../match/WinnerBanner";
import { displayPlayerName } from "../../../shared/players";
import { useAuthSession } from "../../hooks/useAuthSession";
import { useOwnedProfileIndex } from "../../hooks/data/useOwnedProfileIndex";
import { Button } from "../ui/Button";
import buttonStyles from "../ui/Button.module.css";
import {
  SEVEN_WONDERS_CATEGORY_KEYS,
  computeTotalsByPlayer,
  resolveScoreOutcome,
  type SevenWondersCategoryKey,
} from "../../../shared/scoring/7-wonders-duel";
import type { Match, Player, ScoreRow } from "../../types/match";

const SAVE_DEBOUNCE_MS = 300;

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

type Props = {
  match: Match;
};

export function SevenWondersDuelScorer({ match }: Props) {
  const { t } = useTranslation();
  const { session } = useAuthSession();
  const viewerId = session?.user.id ?? null;
  const ownedIndex = useOwnedProfileIndex(viewerId);
  const matchId = match.id;

  const [values, setValues] = useState<ScoreGridValues>(() =>
    buildValuesFromScores(match.players, match.scores),
  );
  const [supremacy, setSupremacy] = useState<SupremacySelection>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<unknown> | null>(null);

  const persistValues = useCallback(
    async (next: ScoreGridValues) => {
      const scores = buildScorePayload(next);
      if (scores.length === 0) return;
      pendingSaveRef.current = upsertScores({ matchId, scores });
      try {
        await pendingSaveRef.current;
      } finally {
        pendingSaveRef.current = null;
      }
    },
    [matchId],
  );

  const flushPendingSave = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
      await persistValues(values);
    }
    if (pendingSaveRef.current) {
      try {
        await pendingSaveRef.current;
      } catch {
        /* errors surface via SyncStatus */
      }
    }
  }, [persistValues, values]);

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
          void persistValues(next);
        }, SAVE_DEBOUNCE_MS);

        return next;
      });
    },
    [persistValues],
  );

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

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
    ? displayPlayerName(supremacyPlayer, ownedIndex)
    : "";

  // displayPlayers carries the embedded `profile` projection through to
  // `HandMatchGrid` so its header can render the Phase 7 avatars + the
  // leader's crown badge without re-resolving names downstream.
  const displayPlayers = match.players.map((p) => ({
    id: p.id,
    name: displayPlayerName(p, ownedIndex),
    profile: p.profile,
  }));

  const [completing, setCompleting] = useState(false);

  const handleComplete = async () => {
    await flushPendingSave();
    setCompleting(true);
    try {
      if (supremacy) {
        await completeMatch({
          matchId,
          victoryType: supremacy.type,
          winnerId: supremacy.playerId,
        });
        return;
      }
      if (outcome.kind === "empty") return;
      if (outcome.kind === "draw") {
        await completeMatch({ matchId, victoryType: "draw", winnerId: null });
        return;
      }
      await completeMatch({
        matchId,
        victoryType: "score",
        winnerId: outcome.winnerId,
      });
    } finally {
      setCompleting(false);
    }
  };

  const winner = match.winnerId
    ? (match.players.find((p) => p.id === match.winnerId) ?? null)
    : null;
  const winnerName = winner ? displayPlayerName(winner, ownedIndex) : null;
  const winnerTotal = winner ? (totals[winner.id] ?? 0) : null;
  // Phase 7: pass the runner-up to the WinnerBanner so it can render
  // their small avatar alongside the winner's. With only two seats in
  // 7WD, the runner-up is whoever isn't the winner.
  const runnerUp =
    isCompleted && winner
      ? (match.players.find((p) => p.id !== winner.id) ?? null)
      : null;
  const loserTotal =
    runnerUp ? (totals[runnerUp.id] ?? 0) : null;

  const scoreWinnerName =
    outcome.kind === "winner"
      ? (() => {
          const p = match.players.find((p) => p.id === outcome.winnerId);
          return p ? displayPlayerName(p, ownedIndex) : "";
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
          winnerProfile={winner?.profile ?? null}
          runnerUpProfile={runnerUp?.profile ?? null}
          viewerId={viewerId}
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
          viewerId={viewerId}
        />
      </div>

      {!isCompleted && (
        <div className="mt-6 mb-6">
          <Button
            type="button"
            onClick={handleComplete}
            disabled={completing}
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
        <>
          <Link
            to="/games/$slug/new"
            params={{ slug: match.game.slug }}
            search={{ rematchOf: match.id }}
            data-testid="swd-rematch"
            className={`mt-6 ${buttonStyles.base} ${buttonStyles.primary} ${buttonStyles.lg} ${buttonStyles.full}`}
            style={{ textDecoration: "none" }}
          >
            {t("matches.rematch")}
          </Link>
          <Link
            to="/games/$slug"
            params={{ slug: match.game.slug }}
            className="mt-3 block text-center text-sm"
            style={{ color: "var(--color-primary)" }}
            data-testid="back-to-game"
          >
            {t("matches.back")}
          </Link>
        </>
      )}
    </>
  );
}
