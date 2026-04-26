import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { SevenWondersDuelScorer } from "../../../components/scoring/SevenWondersDuelScorer";
import type { Match } from "../../../types/match";

export const Route = createFileRoute("/_authenticated/matches/$id")({
  component: MatchPage,
});

function MatchPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();

  const { data: match, isPending } = useQuery<Match>({
    queryKey: ["matches", id],
    queryFn: () => api<Match>(`/api/matches/${id}`),
  });

  if (isPending || !match) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-gray-500">{t("common.loading")}</p>
      </div>
    );
  }

  const gameName = t(`games.catalog.${match.game.slug}.name`, {
    defaultValue: match.game.name,
  });

  return (
    <div className="mx-auto max-w-lg p-4">
      <Link
        to="/games/$slug"
        params={{ slug: match.game.slug }}
        className="text-sm text-blue-600 hover:underline"
      >
        &larr; {gameName}
      </Link>

      {match.game.slug === "7-wonders-duel" ? (
        <SevenWondersDuelScorer match={match} />
      ) : (
        <UnsupportedScorer match={match} gameName={gameName} />
      )}
    </div>
  );
}

function UnsupportedScorer({
  match,
  gameName,
}: {
  match: Match;
  gameName: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="mt-2 text-2xl font-bold">{t("matches.title")}</h1>
      <div
        className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-3"
        data-testid="scoring-not-supported"
      >
        <p className="text-sm text-yellow-900">
          {t("matches.scoringNotSupported", { game: gameName })}
        </p>
      </div>
      <Link
        to="/games/$slug"
        params={{ slug: match.game.slug }}
        className="mt-6 block text-center text-sm text-blue-600 hover:underline"
        data-testid="back-to-game"
      >
        {t("matches.back")}
      </Link>
    </>
  );
}
