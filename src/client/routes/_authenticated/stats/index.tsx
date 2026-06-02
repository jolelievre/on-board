import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Header } from "../../../components/layout/Header";
import { Group } from "../../../components/ui/Group";
import { Avatar } from "../../../components/ui/Avatar";
import { Icon } from "../../../components/ui/Icon";
import { useRequiredViewerId } from "../../../hooks/useRequiredViewerId";
import { useGames } from "../../../hooks/data/useGames";
import { useMyStats } from "../../../hooks/data/useMyStats";
import { useMyGameStats } from "../../../hooks/data/useMyGameStats";
import {
  useGameRankings,
  type GameRankingEntry,
} from "../../../hooks/data/useGameRankings";
import type { LocalGame } from "../../../lib/db";
import styles from "./index.module.css";

export const Route = createFileRoute("/_authenticated/stats/")({
  component: StatsPage,
});

function StatsPage() {
  const { t } = useTranslation();
  const viewerId = useRequiredViewerId();
  const stats = useMyStats(viewerId);
  const { data: games } = useGames();

  return (
    <>
      <Header />
      <div className="px-5">
        <header className={styles.titleRow}>
          <h1 className={styles.title}>{t("stats.title")}</h1>
          <p className={styles.subtitle}>{t("stats.subtitle")}</p>
        </header>

        {/* Hero strip — always rendered; reads `undefined` while loading. */}
        <HeroStrip stats={stats} />

        {/* Favourites pills (most-played game + opponent). */}
        <FavouritesPanel stats={stats} viewerId={viewerId} />

        {/* Per-game cards — one card per known game. Empty card with a
            CTA renders for games the viewer hasn't played yet. */}
        {games && games.length > 0 && (
          <Group title={t("stats.perGame.title")}>
            <div className={styles.gameCardList} data-testid="stats-per-game">
              {games.map((game) => (
                <PerGameCard
                  key={game.id}
                  game={game}
                  viewerId={viewerId}
                />
              ))}
            </div>
          </Group>
        )}

        {/* Rankings panel — one section per game. */}
        {games && games.length > 0 && (
          <Group title={t("stats.rankings.title")}>
            <div className={styles.rankingsList}>
              {games.map((game) => (
                <RankingsSection
                  key={game.id}
                  game={game}
                  viewerId={viewerId}
                />
              ))}
            </div>
          </Group>
        )}
      </div>
    </>
  );
}

function HeroStrip({ stats }: { stats: ReturnType<typeof useMyStats> }) {
  const { t } = useTranslation();
  const matchesPlayed = stats?.matchesPlayed ?? 0;
  const matchesCompleted = stats?.matchesCompleted ?? 0;
  const totalWins = stats?.totalWins ?? 0;
  const winRate = stats?.winRate;

  return (
    <div className={styles.heroGrid} data-testid="stats-hero">
      <HeroStat
        value={matchesPlayed}
        label={t("stats.hero.matches")}
        testid="stats-hero-matches"
      />
      <HeroStat
        value={matchesCompleted}
        label={t("stats.hero.completed")}
        testid="stats-hero-completed"
      />
      <HeroStat
        value={totalWins}
        label={t("stats.hero.wins")}
        testid="stats-hero-wins"
      />
      <HeroStat
        value={
          winRate !== null && winRate !== undefined
            ? `${Math.round(winRate * 100)}%`
            : "—"
        }
        label={t("stats.hero.winRate")}
        testid="stats-hero-win-rate"
      />
    </div>
  );
}

function HeroStat({
  value,
  label,
  testid,
}: {
  value: number | string;
  label: string;
  testid?: string;
}) {
  return (
    <div className={styles.heroStat} data-testid={testid}>
      <span className={styles.heroValue}>{value}</span>
      <span className={styles.heroLabel}>{label}</span>
    </div>
  );
}

function FavouritesPanel({
  stats,
  viewerId,
}: {
  stats: ReturnType<typeof useMyStats>;
  viewerId: string;
}) {
  const { t } = useTranslation();

  if (stats === undefined) {
    return null;
  }
  if (!stats.favouriteGame && !stats.favouriteOpponent) {
    if (stats.matchesPlayed === 0) {
      // Brand-new user: keep the hero strip but hide the favourites
      // panel behind a single inline empty message so the page isn't
      // cluttered with dashed placeholders.
      return (
        <p className={styles.empty} data-testid="stats-empty">
          {t("stats.empty")}
        </p>
      );
    }
    return null;
  }

  return (
    <Group title={t("stats.favourites.title")}>
      <div className={styles.favouritesRow}>
        {stats.favouriteGame && (
          <Link
            to="/games/$slug"
            params={{ slug: stats.favouriteGame.gameSlug }}
            className={styles.favouriteCard}
            data-testid="stats-favourite-game"
          >
            <span className={styles.favouriteEyebrow}>
              {t("stats.favourites.gameLabel")}
            </span>
            <span className={styles.favouriteName}>
              {stats.favouriteGame.gameName}
            </span>
            <span className={styles.favouriteMeta}>
              {t("stats.favourites.gameCount", {
                count: stats.favouriteGame.matches,
              })}
            </span>
          </Link>
        )}
        {stats.favouriteOpponent && (
          <div
            className={styles.favouriteCard}
            data-testid="stats-favourite-opponent"
          >
            <span className={styles.favouriteEyebrow}>
              {t("stats.favourites.opponentLabel")}
            </span>
            <span className={styles.favouriteOpponentRow}>
              <Avatar
                profile={stats.favouriteOpponent.profile}
                viewerId={viewerId}
                size="md"
              />
              <span className={styles.favouriteName}>
                {stats.favouriteOpponent.profile.alias}
              </span>
            </span>
            <span className={styles.favouriteMeta}>
              {t("stats.favourites.opponentCount", {
                count: stats.favouriteOpponent.matches,
              })}
            </span>
          </div>
        )}
      </div>
    </Group>
  );
}

function PerGameCard({
  game,
  viewerId,
}: {
  game: LocalGame;
  viewerId: string;
}) {
  const { t } = useTranslation();
  const stats = useMyGameStats(viewerId, game.id);

  if (stats === undefined) {
    return (
      <div
        className={styles.gameCard}
        data-testid="stats-game-card"
        data-game-slug={game.slug}
      >
        <span className={styles.gameCardName}>{game.name}</span>
        <p className={styles.gameCardEmpty}>{t("common.loading")}</p>
      </div>
    );
  }

  if (stats.matches === 0) {
    return (
      <Link
        to="/games/$slug/new"
        params={{ slug: game.slug }}
        className={`${styles.gameCard} ${styles.gameCardEmptyState}`}
        data-testid="stats-game-card"
        data-game-slug={game.slug}
      >
        <span className={styles.gameCardName}>{game.name}</span>
        <span className={styles.gameCardCta}>
          <Icon name="plus" size={14} />
          {t("stats.perGame.play")}
        </span>
      </Link>
    );
  }

  const winRate =
    stats.winRate !== null ? `${Math.round(stats.winRate * 100)}%` : "—";
  const bestScore = stats.bestScore !== null ? stats.bestScore : "—";

  return (
    <Link
      to="/games/$slug"
      params={{ slug: game.slug }}
      className={styles.gameCard}
      data-testid="stats-game-card"
      data-game-slug={game.slug}
    >
      <span className={styles.gameCardName}>{game.name}</span>
      <div className={styles.gameStatGrid}>
        <SmallStat
          label={t("stats.perGame.matches")}
          value={stats.matches}
          testid="stats-game-matches"
        />
        <SmallStat
          label={t("stats.perGame.winRate")}
          value={winRate}
          testid="stats-game-win-rate"
        />
        <SmallStat
          label={t("stats.perGame.bestScore")}
          value={bestScore}
          testid="stats-game-best-score"
        />
        <SmallStat
          label={t("stats.perGame.currentStreak")}
          value={stats.currentStreak}
          testid="stats-game-current-streak"
        />
        <SmallStat
          label={t("stats.perGame.maxStreak")}
          value={stats.maxStreak}
          testid="stats-game-max-streak"
        />
      </div>
    </Link>
  );
}

function SmallStat({
  label,
  value,
  testid,
}: {
  label: string;
  value: number | string;
  testid?: string;
}) {
  return (
    <div className={styles.smallStat} data-testid={testid}>
      <span className={styles.smallStatValue}>{value}</span>
      <span className={styles.smallStatLabel}>{label}</span>
    </div>
  );
}

function RankingsSection({
  game,
  viewerId,
}: {
  game: LocalGame;
  viewerId: string;
}) {
  const rankings = useGameRankings(viewerId, game.id);

  if (rankings === undefined) return null;
  if (rankings.entries.length === 0) return null;

  return (
    <section
      className={styles.rankingsSection}
      data-testid="stats-rankings-section"
      data-game-slug={game.slug}
    >
      <h4 className={styles.rankingsSectionTitle}>{game.name}</h4>
      <div className={styles.rankingTable}>
        {rankings.entries.map((entry, idx) => (
          <RankingRow
            key={entry.key}
            entry={entry}
            position={idx + 1}
            viewerId={viewerId}
            minMatches={rankings.minMatchesForRate}
          />
        ))}
      </div>
    </section>
  );
}

function RankingRow({
  entry,
  position,
  viewerId,
  minMatches,
}: {
  entry: GameRankingEntry;
  position: number;
  viewerId: string;
  minMatches: number;
}) {
  const { t } = useTranslation();
  const rowClass = [
    styles.rankingRow,
    entry.isMe ? styles.rankingRowMe : "",
    !entry.ranked ? styles.rankingRowGated : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={rowClass}
      data-testid="stats-ranking-row"
      data-profile-key={entry.key}
      data-ranked={entry.ranked ? "true" : "false"}
    >
      <span className={styles.rankingPosition}>{entry.ranked ? position : "·"}</span>
      <Avatar profile={entry.profile} viewerId={viewerId} size="sm" />
      <span className={styles.rankingName}>
        {entry.isMe ? t("stats.rankings.you") : entry.profile.alias}
      </span>
      <span className={styles.rankingMeta}>
        {entry.ranked
          ? `${Math.round(entry.winRate * 100)}% · ${t(
              "stats.rankings.matchesShort",
              { count: entry.completedMatches },
            )}`
          : t("stats.rankings.gate", {
              count: entry.completedMatches,
              min: minMatches,
            })}
      </span>
    </div>
  );
}
