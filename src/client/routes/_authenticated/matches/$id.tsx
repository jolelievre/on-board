import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { SevenWondersDuelScorer } from "../../../components/scoring/SevenWondersDuelScorer";
import { SkullKingScorer } from "../../../components/scoring/skull-king/SkullKingScorer";
import { Header } from "../../../components/layout/Header";
import { Card } from "../../../components/ui/Card";
import { Icon } from "../../../components/ui/Icon";
import {
  SyncPill,
  saveStatusToSyncState,
  type SaveStatus,
} from "../../../components/ui/SyncPill";
import type { Match } from "../../../types/match";

export const Route = createFileRoute("/_authenticated/matches/$id")({
  component: MatchPage,
});

function MatchPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [scoreboardOpen, setScoreboardOpen] = useState(false);

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

  const isInProgress = match.status !== "COMPLETED";
  const is7WD = match.game.slug === "7-wonders-duel";
  const isSkullKing = match.game.slug === "skull-king";

  const showSyncPill = isInProgress && (is7WD || isSkullKing);
  const showScoreboardToggle = isSkullKing && isInProgress;

  return (
    <>
      <Header
        back={{
          to: "/games/$slug",
          params: { slug: match.game.slug },
          label: gameName,
        }}
        right={
          <>
            {showScoreboardToggle && (
              <button
                type="button"
                onClick={() => setScoreboardOpen((v) => !v)}
                aria-label={t(
                  scoreboardOpen
                    ? "scoring.skullKing.closeScoreboard"
                    : "scoring.skullKing.openScoreboard",
                )}
                aria-pressed={scoreboardOpen}
                data-testid="sk-scoreboard-toggle"
                style={{
                  background: scoreboardOpen
                    ? "var(--color-primary)"
                    : "transparent",
                  color: scoreboardOpen
                    ? "var(--color-primary-fg)"
                    : "var(--color-ink-soft)",
                  border: "1.5px solid var(--color-border-strong)",
                  borderColor: scoreboardOpen
                    ? "var(--color-primary)"
                    : "var(--color-border-strong)",
                  borderRadius: 999,
                  padding: 6,
                  width: 36,
                  height: 36,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <Icon name="cards" size={18} />
              </button>
            )}
            {showSyncPill && (
              <SyncPill
                size="lg"
                state={saveStatusToSyncState(saveStatus)}
                data-testid="save-status"
                data-status={saveStatus}
              />
            )}
          </>
        }
      />

      <div className="px-5" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {is7WD ? (
          <SevenWondersDuelScorer
            match={match}
            onSaveStatusChange={setSaveStatus}
          />
        ) : isSkullKing ? (
          <SkullKingScorer
            match={match}
            scoreboardOpen={scoreboardOpen}
            onScoreboardClose={() => setScoreboardOpen(false)}
            onSaveStatusChange={setSaveStatus}
          />
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
