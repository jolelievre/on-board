import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useGames } from "../../../hooks/data/useGames";
import type { GameRow } from "../../../lib/db";
import { Header } from "../../../components/layout/Header";
import { Logo } from "../../../components/ui/Logo";
import { Pill } from "../../../components/ui/Pill";
import { CoverArt } from "../../../components/games/CoverArt";
import styles from "./index.module.css";

export const Route = createFileRoute("/_authenticated/games/")({
  component: GamesPage,
});

function GamesPage() {
  const { t } = useTranslation();
  const { data: games, status: gamesStatus } = useGames();
  const isPending = gamesStatus === "loading";

  return (
    <>
      <Header left={<Logo size={44} />} />
      <div className="px-5 pb-4">
        <h1 className={styles.title}>{t("games.title")}</h1>
        <p className={styles.subtitle}>{t("games.subtitle")}</p>
      </div>

      <div className="px-5">
        {isPending && <p className={styles.empty}>{t("common.loading")}</p>}

        {games && (
          <div className={styles.list}>
            {games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function GameCard({ game }: { game: GameRow }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/games/$slug"
      params={{ slug: game.slug }}
      className={styles.card}
    >
      <CoverArt slug={game.slug} />
      <div className={styles.cardBody}>
        <h2 className={styles.cardName}>
          {t(`games.catalog.${game.slug}.name`, { defaultValue: game.name })}
        </h2>
        <p className={styles.cardDesc}>
          {t(`games.catalog.${game.slug}.description`, {
            defaultValue: game.description,
          })}
        </p>
        <div className={styles.cardMeta}>
          <Pill tone="muted">
            {game.minPlayers}–{game.maxPlayers} {t("games.players")}
          </Pill>
        </div>
      </div>
    </Link>
  );
}
