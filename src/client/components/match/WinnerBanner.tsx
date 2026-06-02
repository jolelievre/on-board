import { useTranslation } from "react-i18next";
import type { PlayerProfile } from "../../types/match";
import { Avatar } from "../ui/Avatar";
import { SketchRect } from "../ui/SketchRect";
import { WinnerBadge } from "../ui/WinnerBadge";
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
  /** Phase 7: avatars on the banner. Pass the embedded profiles from
   * the match's Player rows so the resolver picks up the chosen stamp
   * (frame + ring). Omit to render the banner without avatars (e.g.
   * legacy contexts where Player data isn't on hand). */
  winnerProfile?: PlayerProfile | null;
  runnerUpProfile?: PlayerProfile | null;
  /** Viewer id for the Avatar's resolve logic — required `string`. */
  viewerId: string;
};

export function WinnerBanner({
  winnerName,
  winnerScore,
  loserScore,
  victoryType,
  winnerProfile,
  runnerUpProfile,
  viewerId,
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
        {winnerProfile ? (
          <Avatar
            profile={winnerProfile}
            viewerId={viewerId}
            size="md"
            winner
          />
        ) : (
          // Fallback for callers without a winner profile available —
          // keep the badge so the banner still reads "winner".
          <WinnerBadge size={26} title={t("matches.winnerLabel")} />
        )}
        <div className={styles.titleBlock}>
          <p className={styles.title}>
            {t("matches.winner", { name: winnerName })}
            {scoreLine && <span className={styles.scoreLine}> {scoreLine}</span>}
          </p>
          {victoryType && (
            <p className={styles.subtitle}>
              {t(`matches.victoryType.${victoryType}`, {
                defaultValue: victoryType,
              })}
            </p>
          )}
        </div>
        {runnerUpProfile && (
          <span className={styles.runnerUp}>
            <Avatar profile={runnerUpProfile} viewerId={viewerId} size="sm" />
          </span>
        )}
      </div>
    </div>
  );
}
