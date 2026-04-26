import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import {
  computeTotalsByPlayer,
  type SevenWondersVictoryType,
} from "../../../../shared/scoring/7-wonders-duel";

export const Route = createFileRoute("/_authenticated/games/$slug")({
  component: GameDetailPage,
});

type Game = {
  id: string;
  slug: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
};

type Player = { id: string; name: string; position: number };
type ScoreRow = { playerId: string; category: string; value: number };
type MatchListItem = {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  victoryType: SevenWondersVictoryType | null;
  winnerId: string | null;
  startedAt: string;
  completedAt: string | null;
  players: Player[];
  scores: ScoreRow[];
};

function GameDetailPage() {
  const { slug } = Route.useParams();
  const { t, i18n } = useTranslation();

  const { data: game, isPending } = useQuery<Game>({
    queryKey: ["games", slug],
    queryFn: () => api<Game>(`/api/games/${slug}`),
  });

  const { data: matches } = useQuery<MatchListItem[]>({
    queryKey: ["matches", { gameId: game?.id }],
    queryFn: () => api<MatchListItem[]>(`/api/matches?gameId=${game!.id}`),
    enabled: !!game?.id,
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-gray-500">{t("common.loading")}</p>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-red-500">{t("games.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-4">
      <Link to="/games" className="text-sm text-blue-600 hover:underline">
        &larr; {t("nav.games")}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">
        {t(`games.catalog.${game.slug}.name`, { defaultValue: game.name })}
      </h1>
      <p className="mt-2 text-gray-600">
        {t(`games.catalog.${game.slug}.description`, { defaultValue: game.description })}
      </p>
      <p className="mt-1 text-sm text-gray-400">
        {game.minPlayers}–{game.maxPlayers} {t("games.players")}
      </p>

      <div className="mt-6">
        <Link
          to="/games/$slug/new"
          params={{ slug }}
          className="inline-block rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700"
          data-testid="new-match-button"
        >
          {t("games.newMatch")}
        </Link>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold">{t("games.matchHistory")}</h2>
        <div className="mt-3" data-testid="match-history">
          {!matches || matches.length === 0 ? (
            <p className="text-sm text-gray-400">{t("matches.history.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {matches.map((m) => (
                <MatchHistoryRow key={m.id} match={m} locale={i18n.language} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchHistoryRow({
  match,
  locale,
}: {
  match: MatchListItem;
  locale: string;
}) {
  const { t } = useTranslation();
  const totals = computeTotalsByPlayer(match.scores);
  const winner = match.winnerId
    ? match.players.find((p) => p.id === match.winnerId)
    : null;
  const dateText = new Date(match.startedAt).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <li
      className="rounded-md border border-gray-200 p-3"
      data-testid={`match-history-row-${match.id}`}
    >
      <Link
        to="/matches/$id"
        params={{ id: match.id }}
        className="block hover:underline"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">{dateText}</span>
          {match.status === "IN_PROGRESS" ? (
            <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
              {t("matches.history.inProgress")}
            </span>
          ) : match.victoryType ? (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {t(`matches.victoryType.${match.victoryType}`)}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
          {match.players.map((p) => (
            <span
              key={p.id}
              className={
                winner?.id === p.id ? "font-bold text-gray-900" : "text-gray-700"
              }
            >
              {p.name} ({totals[p.id] ?? 0})
            </span>
          ))}
        </div>
      </Link>
    </li>
  );
}
