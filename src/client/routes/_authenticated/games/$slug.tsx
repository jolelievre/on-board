import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { useOnlineStatus } from "../../../hooks/useOnlineStatus";
import {
  computeTotalsByPlayer,
  type SevenWondersVictoryType,
} from "../../../../shared/scoring/7-wonders-duel";
import { parseRoundCategory } from "../../../../shared/scoring/skull-king";
import { displayPlayerName } from "../../../../shared/players";
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

type Player = {
  id: string;
  name: string;
  position: number;
  user?: { name: string; alias: string | null } | null;
};
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
  const { isOnline } = useOnlineStatus();

  const gameQuery = useQuery<Game>({
    queryKey: ["games", slug],
    queryFn: () => {
      console.info(`[query] fn-fire ['games', '${slug}']`);
      return api<Game>(`/api/games/${slug}`);
    },
  });
  const { data: game, isPending, isPaused } = gameQuery;

  console.debug(`[route /games/${slug}] render`, {
    status: gameQuery.status,
    fetchStatus: gameQuery.fetchStatus,
    isPaused: gameQuery.isPaused,
    hasData: gameQuery.data !== undefined,
    dataUpdatedAt: gameQuery.dataUpdatedAt,
    errorUpdatedAt: gameQuery.errorUpdatedAt,
  });

  const { data: matches } = useQuery<MatchListItem[]>({
    queryKey: ["matches", { gameId: game?.id }],
    queryFn: () => {
      console.info(`[query] fn-fire ['matches', { gameId: '${game!.id}' }]`);
      return api<MatchListItem[]>(`/api/matches?gameId=${game!.id}`);
    },
    enabled: !!game?.id,
  });

  // isPaused: offlineFirst fired the queryFn once, it failed, and the retry
  // is now paused waiting for network. Treat the same as an error with no
  // cache — show the offline-no-cache message instead of spinning forever.
  if (isPending && !isPaused) {
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
              <MatchHistoryRow
                key={m.id}
                match={m}
                locale={i18n.language}
                gameSlug={slug}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}

/** Sum of round_N values per player. Skull King writes one Score row per
 * (player, round_N) with the round's total in `value`, so a flat sum is
 * the match total. */
function computeSkullKingTotalsByPlayer(
  scores: { playerId: string; category: string; value: number }[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of scores) {
    if (parseRoundCategory(s.category) === null) continue;
    totals[s.playerId] = (totals[s.playerId] ?? 0) + s.value;
  }
  return totals;
}

function computeMatchTotalsBySlug(
  slug: string,
  scores: { playerId: string; category: string; value: number }[],
): Record<string, number> {
  if (slug === "skull-king") return computeSkullKingTotalsByPlayer(scores);
  return computeTotalsByPlayer(scores);
}

function MatchHistoryRow({
  match,
  locale,
  gameSlug,
}: {
  match: MatchListItem;
  locale: string;
  gameSlug: string;
}) {
  const { t } = useTranslation();
  const totals = computeMatchTotalsBySlug(gameSlug, match.scores);
  const winner = match.winnerId
    ? match.players.find((p) => p.id === match.winnerId)
    : null;
  const dateText = new Date(match.startedAt).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const isCompleted = match.status === "COMPLETED";
  const compact = match.players.length === 2;

  // Multi-player matches sort the player rows by score (leader first) so the
  // standings read at a glance — even mid-match. Two-player matches keep
  // their position-ordered "vs" layout.
  const orderedPlayers = compact
    ? match.players
    : [...match.players].sort(
        (a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0),
      );

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

      {compact ? (
        <div className={styles.players}>
          {orderedPlayers.map((p, idx) => {
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
                    {displayPlayerName(p)}
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
                {idx < orderedPlayers.length - 1 && (
                  <span className={styles.versus}>
                    {t("matches.history.vs")}
                  </span>
                )}
              </Fragment>
            );
          })}
        </div>
      ) : (
        <div className={styles.podium} data-testid="match-history-podium">
          {orderedPlayers.slice(0, 3).map((p, idx) => {
            const isWinner = winner?.id === p.id;
            const isDim = isCompleted && winner !== null && !isWinner;
            return (
              <span
                key={p.id}
                className={`${styles.podiumEntry} ${isWinner ? styles.podiumWinner : ""}`}
              >
                <span className={styles.podiumRank}>#{idx + 1}</span>
                <span
                  className={[
                    styles.podiumName,
                    isWinner && styles.playerNameWinner,
                    isDim && styles.playerNameDim,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-testid={`match-history-score-${p.id}`}
                  data-score={totals[p.id] ?? 0}
                >
                  {displayPlayerName(p)}
                </span>
              </span>
            );
          })}
          {orderedPlayers.length > 3 && (
            <span className={styles.podiumMore}>
              +{orderedPlayers.length - 3}
            </span>
          )}
        </div>
      )}
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
