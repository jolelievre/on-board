import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useOnlineStatus } from "../../../hooks/useOnlineStatus";
import { useAuthSession } from "../../../hooks/useAuthSession";
import { useGame } from "../../../hooks/data/useGame";
import { useMatchList } from "../../../hooks/data/useMatchList";
import { Header } from "../../../components/layout/Header";
import { Pill } from "../../../components/ui/Pill";
import { Icon } from "../../../components/ui/Icon";
import { CoverArt } from "../../../components/games/CoverArt";
import { MatchHistoryRow } from "../../../components/matches/MatchHistoryRow";
import buttonStyles from "../../../components/ui/Button.module.css";
import styles from "./$slug.module.css";

export const Route = createFileRoute("/_authenticated/games/$slug")({
  component: GameDetailPage,
});

function GameDetailPage() {
  const { slug } = Route.useParams();
  const { t, i18n } = useTranslation();
  const { isOnline } = useOnlineStatus();
  const { session } = useAuthSession();
  const viewerId = session?.user.id ?? null;

  const { data: game, status: gameStatus } = useGame(slug);
  const { data: matches } = useMatchList(game?.id);

  if (gameStatus === "loading") {
    return (
      <>
        <Header
          back={{ to: "/games", label: t("nav.games") }}
        />
        <div className="px-5">
          <p style={{ color: "var(--color-ink-faint)" }}>{t("common.loading")}</p>
        </div>
      </>
    );
  }

  if (!game) {
    const isOfflineMiss = !isOnline;
    return (
      <>
        <Header
          back={{ to: "/games", label: t("nav.games") }}
        />
        <div className="px-5">
          <p
            style={{
              color: isOfflineMiss
                ? "var(--color-ink-faint)"
                : "var(--color-danger)",
            }}
          >
            {isOfflineMiss ? t("common.offlineNoCache") : t("games.notFound")}
          </p>
        </div>
      </>
    );
  }

  const completedCount = matches?.filter((m) => m.status === "COMPLETED").length ?? 0;

  return (
    <>
      <Header back={{ to: "/games", label: t("nav.games") }} />

      <div className="px-5">
        <div className={styles.cover}>
          <CoverArt slug={game.slug} width={350} height={120} fluid />
        </div>

        <h1 className={styles.title}>
          {t(`games.catalog.${game.slug}.name`, { defaultValue: game.name })}
        </h1>
        <p className={styles.description}>
          {t(`games.catalog.${game.slug}.description`, {
            defaultValue: game.description,
          })}
        </p>
        <div className={styles.pills}>
          <Pill tone="muted">
            {game.minPlayers}–{game.maxPlayers} {t("games.players")}
          </Pill>
          {completedCount > 0 && (
            <Pill tone="primary">
              {t("games.matchesCount", { count: completedCount })}
            </Pill>
          )}
        </div>

        <div className="mt-5">
          <Link
            to="/games/$slug/new"
            params={{ slug }}
            data-testid="new-match-button"
            className={`${buttonStyles.base} ${buttonStyles.primary} ${buttonStyles.lg} ${buttonStyles.full}`}
          >
            <Icon name="plus" size={18} />
            {t("games.newMatch")}
          </Link>
        </div>

        <h3 className={styles.historyHeader}>{t("games.matchHistory")}</h3>
        <div data-testid="match-history" className={styles.history}>
          {!matches || matches.length === 0 ? (
            <EmptyHistory />
          ) : (
            matches.map((m) => (
              <MatchHistoryRow
                key={m.id}
                match={m}
                locale={i18n.language}
                gameSlug={slug}
                viewerId={viewerId}
                // The page header already identifies the game; the
                // floating top-left glyph would be redundant here.
                showGameGlyph={false}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}

function EmptyHistory() {
  const { t } = useTranslation();
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name="dice" size={22} />
      </span>
      <p className={styles.emptyText}>{t("games.noMatches")}</p>
    </div>
  );
}
