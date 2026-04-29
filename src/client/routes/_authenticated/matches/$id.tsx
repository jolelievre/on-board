import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { SevenWondersDuelScorer } from "../../../components/scoring/SevenWondersDuelScorer";
import { Header } from "../../../components/layout/Header";
import { Card } from "../../../components/ui/Card";
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
      <>
        <Header back={{ to: "/games", label: t("nav.games") }} />
        <div className="px-5">
          <p style={{ color: "var(--color-ink-faint)" }}>{t("common.loading")}</p>
        </div>
      </>
    );
  }

  const gameName = t(`games.catalog.${match.game.slug}.name`, {
    defaultValue: match.game.name,
  });

  return (
    <>
      <Header
        back={{
          to: "/games/$slug",
          params: { slug: match.game.slug },
          label: gameName,
        }}
      />

      <div className="px-5">
        {match.game.slug === "7-wonders-duel" ? (
          <SevenWondersDuelScorer match={match} />
        ) : (
          <UnsupportedScorer match={match} gameName={gameName} />
        )}
      </div>
    </>
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
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "1.75rem",
          margin: 0,
          letterSpacing: "-0.025em",
          color: "var(--color-ink)",
        }}
      >
        {t("matches.title")}
      </h1>
      <Card className="mt-4" data-testid="scoring-not-supported">
        <p style={{ color: "var(--color-warning)", margin: 0 }}>
          {t("matches.scoringNotSupported", { game: gameName })}
        </p>
      </Card>
      <Link
        to="/games/$slug"
        params={{ slug: match.game.slug }}
        className="mt-6 block text-center text-sm"
        style={{ color: "var(--color-primary)" }}
        data-testid="back-to-game"
      >
        {t("matches.back")}
      </Link>
    </>
  );
}
