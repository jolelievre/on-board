import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOnlineStatus } from "../../../hooks/useOnlineStatus";
import { useRequiredViewerId } from "../../../hooks/useRequiredViewerId";
import { useMatch } from "../../../hooks/data/useMatch";
import { SevenWondersDuelScorer } from "../../../components/scoring/SevenWondersDuelScorer";
import { SkullKingScorer } from "../../../components/scoring/skull-king/SkullKingScorer";
import { DeleteMatchDialog } from "../../../components/matches/DeleteMatchDialog";
import { Header } from "../../../components/layout/Header";
import { Card } from "../../../components/ui/Card";
import { Icon } from "../../../components/ui/Icon";
import type { Match } from "../../../types/match";

export const Route = createFileRoute("/_authenticated/matches/$id")({
  component: MatchPage,
});

function MatchPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isOnline } = useOnlineStatus();
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const viewerId = useRequiredViewerId();

  const { data: match, status } = useMatch(id, viewerId);

  if (status === "loading") {
    return (
      <>
        <Header back={{ to: "/games", label: t("nav.games") }} />
        <div className="px-5">
          <p style={{ color: "var(--color-ink-faint)" }}>{t("common.loading")}</p>
        </div>
      </>
    );
  }

  if (!match) {
    const isOfflineMiss = !isOnline;
    return (
      <>
        <Header back={{ to: "/games", label: t("nav.games") }} />
        <div className="px-5">
          <p
            style={{
              color: isOfflineMiss
                ? "var(--color-ink-faint)"
                : "var(--color-danger)",
            }}
          >
            {isOfflineMiss ? t("common.offlineNoCache") : t("matches.notFound")}
          </p>
        </div>
      </>
    );
  }

  const gameName = t(`games.catalog.${match.game.slug}.name`, {
    defaultValue: match.game.name,
  });

  const isSkullKing = match.game.slug === "skull-king";
  const is7WD = match.game.slug === "7-wonders-duel";
  // Scoreboard toggle is available throughout a Skull King match — including
  // after completion — so the header chrome is consistent with the explicit
  // CTA on the match-complete screen.
  const showScoreboardToggle = isSkullKing;
  // Phase 8-G — creator-only delete affordance in the Header. The
  // server's `DELETE /api/matches/:id` enforces creator-only; the UI
  // mirrors that gate so non-creators never see the button.
  const canDelete = match.createdById === viewerId;

  return (
    <>
      <Header
        back={{
          to: "/games/$slug",
          params: { slug: match.game.slug },
          label: gameName,
        }}
        right={
          showScoreboardToggle || canDelete ? (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
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
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  aria-label={t("matches.delete.cta")}
                  data-testid="match-delete-trigger"
                  style={{
                    background: "transparent",
                    color: "var(--color-ink-soft)",
                    border: "1.5px solid var(--color-border-strong)",
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
                  <Icon name="trash" size={18} />
                </button>
              )}
            </span>
          ) : null
        }
      />

      <div className="px-5" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {is7WD ? (
          <SevenWondersDuelScorer match={match} />
        ) : isSkullKing ? (
          <SkullKingScorer
            match={match}
            scoreboardOpen={scoreboardOpen}
            onScoreboardOpen={() => setScoreboardOpen(true)}
            onScoreboardClose={() => setScoreboardOpen(false)}
          />
        ) : (
          <UnsupportedScorer match={match} gameName={gameName} />
        )}
      </div>

      {deleteOpen && (
        <DeleteMatchDialog
          matchId={match.id}
          viewerId={viewerId}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false);
            // After a successful delete the local Dexie row is gone, so
            // `useMatch` would flip to `status: "missing"`. Navigate back
            // to the per-game history before that transition renders
            // a not-found state mid-fade.
            void navigate({
              to: "/games/$slug",
              params: { slug: match.game.slug },
            });
          }}
        />
      )}
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
