import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import {
  computeTotalsByPlayer,
  type SevenWondersVictoryType,
} from "../../../../shared/scoring/7-wonders-duel";
import { Header } from "../../../components/layout/Header";
import { Pill } from "../../../components/ui/Pill";
import { Icon } from "../../../components/ui/Icon";
import { CoverArt } from "../../../components/games/CoverArt";
import buttonStyles from "../../../components/ui/Button.module.css";
import styles from "./$slug.module.css";

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
  victoryType: SevenWondersVictoryType | "draw" | null;
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
    return (
      <>
        <Header
          back={{ to: "/games", label: t("nav.games") }}
        />
        <div className="px-5">
          <p style={{ color: "var(--color-danger)" }}>{t("games.notFound")}</p>
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
          <CoverArt slug={game.slug} width={350} height={120} />
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
              <MatchHistoryRow key={m.id} match={m} locale={i18n.language} />
            ))
          )}
        </div>
      </div>
    </>
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

  const isCompleted = match.status === "COMPLETED";

  return (
    <Link
      to="/matches/$id"
      params={{ id: match.id }}
      data-testid={`match-history-row-${match.id}`}
      className={styles.matchCard}
    >
      <div className={styles.matchHead}>
        <span className={styles.matchDate}>{dateText}</span>
        {!isCompleted ? (
          <Pill tone="warning">{t("matches.history.inProgress")}</Pill>
        ) : match.victoryType ? (
          <Pill tone={match.victoryType === "score" ? "muted" : "primary"}>
            {t(`matches.victoryType.${match.victoryType}`)}
          </Pill>
        ) : null}
      </div>

      <div className={styles.players}>
        {match.players.map((p, idx) => {
          const isWinner = winner?.id === p.id;
          const isDim = isCompleted && winner !== null && !isWinner;
          return (
            <Fragment key={p.id}>
              <div
                className={`${styles.playerCell} ${isWinner ? styles.playerWinner : ""}`}
              >
                <span
                  className={[
                    styles.playerName,
                    isWinner && styles.playerNameWinner,
                    isDim && styles.playerNameDim,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {isWinner && <Icon name="trophy" size={13} />}
                  {p.name}
                </span>
                <span
                  data-testid={`match-history-score-${p.id}`}
                  className={[
                    styles.playerScore,
                    isWinner && styles.playerScoreWinner,
                    isDim && styles.playerScoreDim,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {totals[p.id] ?? 0}
                </span>
              </div>
              {idx < match.players.length - 1 && (
                <span className={styles.versus}>{t("matches.history.vs")}</span>
              )}
            </Fragment>
          );
        })}
      </div>
    </Link>
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
