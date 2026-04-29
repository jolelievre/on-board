import { useTranslation } from "react-i18next";
import shared from "./shared.module.css";
import styles from "./RoundTransitionScreen.module.css";
import { displayPlayerName } from "../../../../shared/players";
import type { Player } from "../../../types/match";

type Standing = {
  player: Player;
  total: number;
  /** Score delta from the most recently completed round. */
  lastDelta: number;
};

type Props = {
  /** The round that just ended. */
  completedRound: number;
  /** The next round (1-based). */
  nextRound: number;
  /** Player who deals the next round. */
  nextDealer: Player;
  /** Standings sorted by total (leader first). */
  standings: Standing[];
  onContinue: () => void;
};

export function RoundTransitionScreen({
  completedRound,
  nextRound,
  nextDealer,
  standings,
  onContinue,
}: Props) {
  const { t } = useTranslation();
  const cardCount = Math.min(nextRound, 8);

  return (
    <div
      className={`${shared.screen} ${styles.body}`}
      data-testid="sk-transition"
    >
      <div className={styles.heading}>
        <div className={shared.caption}>
          {t("scoring.skullKing.transition.caption", { n: completedRound })}
        </div>
        <h1 className={styles.bigTitle}>
          {t("scoring.skullKing.transition.roundTitle", { n: nextRound })}
        </h1>
        <p className={styles.subtitle}>
          {t("scoring.skullKing.transition.cardsEach", {
            count: nextRound,
            name: displayPlayerName(nextDealer),
          })}
        </p>
      </div>

      <div className={styles.cardStack} aria-hidden>
        {Array.from({ length: cardCount }).map((_, i) => (
          <div
            key={i}
            className={styles.card}
            style={{
              left: `calc(50% + ${(i - cardCount / 2) * 14}px)`,
              top: 8 + i * 1,
              transform: `rotate(${(i - cardCount / 2) * 4}deg)`,
            }}
          >
            {i === cardCount - 1 ? "⚓" : ""}
          </div>
        ))}
      </div>

      <div className={styles.standings} data-testid="sk-transition-standings">
        <div className={shared.caption}>
          {t("scoring.skullKing.transition.standingsTitle")}
        </div>
        {standings.map((row, i) => {
          const sign = row.lastDelta >= 0 ? "+" : "";
          const direction = row.lastDelta >= 0 ? styles.up : styles.down;
          return (
            <div
              key={row.player.id}
              className={styles.standingsRow}
              data-testid={`sk-transition-standing-${i}`}
            >
              <span className={styles.standingsRank}>#{i + 1}</span>
              <span className={styles.standingsName}>
                {displayPlayerName(row.player)}
              </span>
              <span className={`${styles.standingsDelta} ${direction}`}>
                {sign}
                {row.lastDelta}
              </span>
              <span className={styles.standingsTotal}>{row.total}</span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={shared.btnPrimary}
        onClick={onContinue}
        style={{ marginTop: "auto" }}
        data-testid="sk-transition-continue"
      >
        {t("scoring.skullKing.transition.continueCta", { n: nextRound })}
      </button>
    </div>
  );
}
