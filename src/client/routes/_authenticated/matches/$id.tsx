import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { db } from "../../../lib/db";
import {
  SYNC_DRAFTS_RESOLVED_EVENT,
  type SyncDraftsResolvedDetail,
} from "../../../lib/sync";
import { useOnlineStatus } from "../../../hooks/useOnlineStatus";
import { SevenWondersDuelScorer } from "../../../components/scoring/SevenWondersDuelScorer";
import { SkullKingScorer } from "../../../components/scoring/skull-king/SkullKingScorer";
import { Header } from "../../../components/layout/Header";
import { Card } from "../../../components/ui/Card";
import { Icon } from "../../../components/ui/Icon";
import { Pill } from "../../../components/ui/Pill";
import {
  SyncPill,
  saveStatusToSyncState,
  type SaveStatus,
} from "../../../components/ui/SyncPill";
import type { Match } from "../../../types/match";

const DRAFT_PREFIX = "draft_";

export const Route = createFileRoute("/_authenticated/matches/$id")({
  component: MatchPage,
});

function MatchPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isOnline } = useOnlineStatus();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [scoreboardOpen, setScoreboardOpen] = useState(false);

  const isDraft = id.startsWith(DRAFT_PREFIX);

  // If the user lands on a draft URL whose POST has already been replayed,
  // jump them to the real match URL. Doing this on mount keeps the address
  // bar in sync with the canonical id and lets `replace` swap history so a
  // back-press doesn't strand them on the dead draft URL.
  //
  // Also re-checks when the sync engine flushes a draft mid-session — the
  // event carries the draft→real id mapping so we can redirect without
  // hitting Dexie again.
  //
  // The matchDrafts row itself is owned by `syncEngine` (see
  // `reconcileDrafts` in `lib/sync.ts`): the route never deletes it. A
  // mid-flush reload after a route-side delete would lose the
  // `draft_xxx → realId` mapping that the engine pre-loads to handle queue
  // entries replayed in subsequent passes.
  useEffect(() => {
    if (!isDraft) return;
    let cancelled = false;
    const redirectTo = (realId: string) => {
      if (cancelled) return;
      navigate({
        to: "/matches/$id",
        params: { id: realId },
        replace: true,
      });
    };
    void db.matchDrafts.get(id).then((draft) => {
      if (draft?.realId) redirectTo(draft.realId);
    });
    const onResolved = (e: Event) => {
      const detail = (e as CustomEvent<SyncDraftsResolvedDetail>).detail;
      const realId = detail?.mappings?.[id];
      if (realId) redirectTo(realId);
    };
    window.addEventListener(SYNC_DRAFTS_RESOLVED_EVENT, onResolved);
    return () => {
      cancelled = true;
      window.removeEventListener(SYNC_DRAFTS_RESOLVED_EVENT, onResolved);
    };
  }, [id, isDraft, navigate]);

  const { data: match, isPending, isPaused } = useQuery<Match>({
    queryKey: ["matches", id],
    // Drafts have no server resource yet — return the cache value (seeded
    // by the new-match form) without ever hitting the network.
    queryFn: isDraft
      ? () => Promise.reject(new Error("draft-only"))
      : () => api<Match>(`/api/matches/${id}`),
    enabled: !isDraft,
  });

  if (isPending && !isPaused) {
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

  const isInProgress = match.status !== "COMPLETED";
  const is7WD = match.game.slug === "7-wonders-duel";
  const isSkullKing = match.game.slug === "skull-king";

  const showSyncPill = isInProgress && (is7WD || isSkullKing);
  // Scoreboard toggle is available throughout a Skull King match — including
  // after completion — so the header chrome is consistent with the explicit
  // CTA on the match-complete screen.
  const showScoreboardToggle = isSkullKing;

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
            {isDraft && (
              <Pill tone="muted" data-testid="match-draft-badge">
                {t("matches.draftBadge", { defaultValue: "Draft" })}
              </Pill>
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
            onScoreboardOpen={() => setScoreboardOpen(true)}
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
