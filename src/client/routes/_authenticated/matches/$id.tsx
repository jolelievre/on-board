import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import {
  SevenWondersScoreGrid,
  type ScoreGridValues,
} from "../../../components/scoring/SevenWondersScoreGrid";
import {
  SEVEN_WONDERS_CATEGORY_KEYS,
  computeTotalsByPlayer,
  resolveScoreOutcome,
  type SevenWondersCategoryKey,
  type SevenWondersVictoryType,
} from "../../../../shared/scoring/7-wonders-duel";

export const Route = createFileRoute("/_authenticated/matches/$id")({
  component: MatchPage,
});

const SAVE_DEBOUNCE_MS = 300;

type Player = { id: string; name: string; position: number };

type ScoreRow = {
  playerId: string;
  category: string;
  value: number;
};

type CompletedVictoryType = SevenWondersVictoryType | "draw";

type Match = {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  victoryType: CompletedVictoryType | null;
  winnerId: string | null;
  game: { id: string; slug: string; name: string };
  players: Player[];
  scores: ScoreRow[];
};

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
      !(SEVEN_WONDERS_CATEGORY_KEYS as ReadonlyArray<string>).includes(
        s.category,
      )
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

function MatchPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: match, isPending } = useQuery<Match>({
    queryKey: ["matches", id],
    queryFn: () => api<Match>(`/api/matches/${id}`),
  });

  const [values, setValues] = useState<ScoreGridValues>({});
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<unknown> | null>(null);

  // Hydrate local state once when match data arrives
  useEffect(() => {
    if (match && !hydrated) {
      setValues(buildValuesFromScores(match.players, match.scores));
      setHydrated(true);
    }
  }, [match, hydrated]);

  const saveScores = useMutation({
    mutationFn: (scores: ScorePayload[]) =>
      api(`/api/matches/${id}/scores`, {
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
        // surface via saveStatus
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
      api<Match>(`/api/matches/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          status: "COMPLETED",
          victoryType: input.victoryType,
          winnerId: input.winnerId,
        }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Match>(["matches", id], (prev) =>
        prev ? { ...prev, ...updated } : updated,
      );
      queryClient.invalidateQueries({ queryKey: ["matches"] });
    },
  });

  const totals = useMemo(() => {
    if (!match) return {} as Record<string, number>;
    const flat = match.players.flatMap((p) =>
      SEVEN_WONDERS_CATEGORY_KEYS.map((cat) => ({
        playerId: p.id,
        category: cat,
        value: values[p.id]?.[cat] ?? 0,
      })),
    );
    return computeTotalsByPlayer(flat);
  }, [match, values]);

  const coins = useMemo(() => {
    const out: Record<string, number> = {};
    if (!match) return out;
    for (const p of match.players) out[p.id] = values[p.id]?.treasury ?? 0;
    return out;
  }, [match, values]);

  const outcome = useMemo(
    () => resolveScoreOutcome(totals, coins),
    [totals, coins],
  );
  const isCompleted = match?.status === "COMPLETED";

  const handleCompleteByScore = async () => {
    if (outcome.kind === "empty") return;
    await flushPendingSave();
    if (outcome.kind === "draw") {
      completeMatch.mutate({ victoryType: "draw", winnerId: null });
    } else {
      completeMatch.mutate({ victoryType: "score", winnerId: outcome.winnerId });
    }
  };

  const handleSpecialVictory = async (
    victoryType: "military_supremacy" | "scientific_supremacy",
    winnerId: string,
  ) => {
    await flushPendingSave();
    completeMatch.mutate({ victoryType, winnerId });
  };

  if (isPending || !match) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-gray-500">{t("common.loading")}</p>
      </div>
    );
  }

  const winner = match.winnerId
    ? match.players.find((p) => p.id === match.winnerId)
    : null;

  return (
    <div className="mx-auto max-w-lg p-4">
      <Link
        to="/games/$slug"
        params={{ slug: match.game.slug }}
        className="text-sm text-blue-600 hover:underline"
      >
        &larr; {t(`games.catalog.${match.game.slug}.name`, { defaultValue: match.game.name })}
      </Link>

      <div className="mt-2 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{t("matches.title")}</h1>
        {!isCompleted && (
          <span
            className="text-xs text-gray-500"
            data-testid="save-status"
            data-status={saveStatus}
          >
            {saveStatus === "saving" && t("matches.saving")}
            {saveStatus === "saved" && t("matches.saved")}
            {saveStatus === "error" && t("matches.saveError")}
          </span>
        )}
      </div>

      {isCompleted && (
        <div
          className="mt-4 rounded-md border border-green-200 bg-green-50 p-3"
          data-testid="winner-banner"
        >
          <p className="text-sm font-semibold text-green-900">
            {winner ? t("matches.winner", { name: winner.name }) : t("matches.draw")}
          </p>
          {match.victoryType && (
            <p className="text-xs text-green-700">
              {t(`matches.victoryType.${match.victoryType}`)}
            </p>
          )}
        </div>
      )}

      <div className="mt-4">
        <SevenWondersScoreGrid
          players={match.players}
          values={values}
          onChange={handleScoreChange}
          disabled={isCompleted}
        />
      </div>

      {!isCompleted && (
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleCompleteByScore}
            disabled={completeMatch.isPending}
            data-testid="complete-match"
            data-outcome={outcome.kind}
            className="rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 disabled:bg-gray-400"
          >
            {outcome.kind === "draw"
              ? t("matches.declareDraw")
              : t("matches.complete")}
          </button>
          {outcome.kind === "winner" && outcome.viaTiebreaker && (
            <p className="text-xs text-gray-500" data-testid="tiebreaker-hint">
              {t("matches.tiebreakerHint", {
                name:
                  match.players.find((p) => p.id === outcome.winnerId)?.name ?? "",
              })}
            </p>
          )}

          <SpecialVictorySection
            label={t("scoring.sevenWondersDuel.specialVictory.military")}
            players={match.players}
            onDeclare={(winnerId) =>
              handleSpecialVictory("military_supremacy", winnerId)
            }
            disabled={completeMatch.isPending}
            testIdPrefix="declare-military"
          />
          <SpecialVictorySection
            label={t("scoring.sevenWondersDuel.specialVictory.scientific")}
            players={match.players}
            onDeclare={(winnerId) =>
              handleSpecialVictory("scientific_supremacy", winnerId)
            }
            disabled={completeMatch.isPending}
            testIdPrefix="declare-scientific"
          />
        </div>
      )}

      {isCompleted && (
        <Link
          to="/games/$slug"
          params={{ slug: match.game.slug }}
          className="mt-6 block text-center text-sm text-blue-600 hover:underline"
          data-testid="back-to-game"
        >
          {t("matches.back")}
        </Link>
      )}
    </div>
  );
}

type SpecialVictorySectionProps = {
  label: string;
  players: Player[];
  onDeclare: (winnerId: string) => void;
  disabled?: boolean;
  testIdPrefix: string;
};

function SpecialVictorySection({
  label,
  players,
  onDeclare,
  disabled,
  testIdPrefix,
}: SpecialVictorySectionProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <p className="text-sm font-semibold text-gray-700">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {players.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onDeclare(p.id)}
            data-testid={`${testIdPrefix}-${p.id}`}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {t("scoring.sevenWondersDuel.specialVictory.declareFor", { name: p.name })}
          </button>
        ))}
      </div>
    </div>
  );
}
