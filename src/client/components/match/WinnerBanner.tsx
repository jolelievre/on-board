import { useTranslation } from "react-i18next";
import { SketchRect } from "../ui/SketchRect";
import styles from "./WinnerBanner.module.css";

type Props = {
  /** Winning player. Null on draw. */
  winnerName: string | null;
  /** Winner's total VP (for the banner score line). */
  winnerScore: number | null;
  /** Loser's total VP. Optional — only used to format the score line. */
  loserScore: number | null;
  /** Mapped victory type from the server. */
  victoryType: string | null;
};

export function WinnerBanner({
  winnerName,
  winnerScore,
  loserScore,
  victoryType,
}: Props) {
  const { t } = useTranslation();

  if (!winnerName) {
    return (
      <div className={styles.banner} data-testid="winner-banner">
        <SketchRect
          width={350}
          height={66}
          stroke="var(--color-accent)"
          fill="color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))"
          seed={42}
          strokeWidth={2.2}
        />
        <div className={`${styles.body} ${styles.draw}`}>
          <div style={{ flex: 1 }}>
            <p className={styles.drawTitle}>{t("matches.draw")}</p>
            {victoryType && (
              <p className={styles.drawSubtitle}>
                {t(`matches.victoryType.${victoryType}`, {
                  defaultValue: victoryType,
                })}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const hasScores = winnerScore !== null && loserScore !== null;
  const scoreLine = hasScores
    ? `${winnerScore} – ${loserScore}`
    : winnerScore !== null
      ? String(winnerScore)
      : "";

  return (
    <div className={styles.banner} data-testid="winner-banner">
      <SketchRect
        width={350}
        height={66}
        stroke="var(--color-accent)"
        fill="color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))"
        seed={42}
        strokeWidth={2.2}
      />
      <div className={styles.body}>
        <span className={styles.trophy} aria-hidden>
          🏆
        </span>
        <div>
          <p className={styles.title}>
            {t("matches.winner", { name: winnerName })}
            {scoreLine && <> {scoreLine}</>}
          </p>
          {victoryType && (
            <p className={styles.subtitle}>
              {t(`matches.victoryType.${victoryType}`, {
                defaultValue: victoryType,
              })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
