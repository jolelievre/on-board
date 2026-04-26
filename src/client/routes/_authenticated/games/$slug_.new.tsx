import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../../lib/api";

export const Route = createFileRoute("/_authenticated/games/$slug_/new")({
  component: NewMatchPage,
});

type Game = {
  id: string;
  slug: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
};

type Match = {
  id: string;
};

function NewMatchPage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: game, isPending } = useQuery<Game>({
    queryKey: ["games", slug],
    queryFn: () => api<Game>(`/api/games/${slug}`),
  });

  const { data: suggestions = [] } = useQuery<string[]>({
    queryKey: ["players", "suggestions"],
    queryFn: () => api<string[]>("/api/players/suggestions"),
  });

  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Initialize player slots once the game's minPlayers is known.
  useEffect(() => {
    if (game && names.length === 0) {
      setNames(Array.from({ length: game.minPlayers }, () => ""));
    }
  }, [game, names.length]);

  const createMatch = useMutation({
    mutationFn: (input: { gameId: string; players: string[] }) =>
      api<Match>("/api/matches", {
        method: "POST",
        body: JSON.stringify({
          gameId: input.gameId,
          players: input.players.map((name, i) => ({ name, position: i })),
        }),
      }),
    onSuccess: (match) => {
      navigate({ to: "/matches/$id", params: { id: match.id } });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Unknown error");
    },
  });

  if (isPending || !game) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-gray-500">{t("common.loading")}</p>
      </div>
    );
  }

  const canRemove = names.length > game.minPlayers;
  const canAdd = names.length < game.maxPlayers;

  const handleAddPlayer = () => {
    if (!canAdd) return;
    setNames((prev) => [...prev, ""]);
  };

  const handleRemovePlayer = (index: number) => {
    if (names.length <= game.minPlayers) return;
    setNames((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = names.map((n) => n.trim());
    if (trimmed.some((n) => n.length === 0)) {
      setError(t("matches.newMatch.missingName"));
      return;
    }
    const lower = trimmed.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      setError(t("matches.newMatch.duplicateNames"));
      return;
    }

    createMatch.mutate({ gameId: game.id, players: trimmed });
  };

  return (
    <div className="mx-auto max-w-lg p-4">
      <Link
        to="/games/$slug"
        params={{ slug }}
        className="text-sm text-blue-600 hover:underline"
      >
        &larr; {t(`games.catalog.${game.slug}.name`, { defaultValue: game.name })}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{t("matches.newMatch.title")}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {t("matches.newMatch.playerRange", {
          min: game.minPlayers,
          max: game.maxPlayers,
        })}
      </p>

      <datalist id="player-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        {names.map((value, i) => (
          <div key={i} className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">
                {t("matches.newMatch.playerLabel", { n: i + 1 })}
              </span>
              <input
                type="text"
                name={`player-${i}`}
                data-testid={`new-match-player-${i}`}
                list="player-suggestions"
                autoComplete="off"
                placeholder={t("matches.newMatch.playerPlaceholder")}
                value={value}
                onChange={(e) => {
                  setNames((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  });
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none"
              />
            </label>
            {canRemove && (
              <button
                type="button"
                onClick={() => handleRemovePlayer(i)}
                aria-label={t("matches.newMatch.removePlayer", { n: i + 1 })}
                data-testid={`new-match-remove-${i}`}
                className="h-10 w-10 shrink-0 rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {canAdd && (
          <button
            type="button"
            onClick={handleAddPlayer}
            data-testid="new-match-add-player"
            className="self-start rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-blue-500 hover:text-blue-700"
          >
            + {t("matches.newMatch.addPlayer")}
          </button>
        )}

        {error && (
          <p className="text-sm text-red-600" data-testid="new-match-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={createMatch.isPending}
          data-testid="new-match-submit"
          className="mt-2 rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 disabled:bg-gray-400"
        >
          {t("matches.newMatch.start")}
        </button>
      </form>
    </div>
  );
}
