import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import shared from "./shared.module.css";
import styles from "./MatchCompleteScreen.module.css";
import { SkullGlyph } from "../../ui/sk/SkGlyphs";
import { displayPlayerName } from "../../../../shared/players";
import type { Player } from "../../../types/match";

type Props = {
  players: Player[];
  totals: Record<string, number>;
  /** Player marked as the match winner. Null on a tie. */
  winner: Player | null;
  /** Whether the match ended in a draw (≥2 players tied for the top score). */
  isDraw: boolean;
  /** Game slug used by the back link (e.g. "skull-king"). */
  gameSlug: string;
  roundsPlayed: number;
};

export function MatchCompleteScreen({
  players,
  totals,
  winner,
  isDraw,
  gameSlug,
  roundsPlayed,
}: Props) {
  const { t } = useTranslation();
  const ranked = [...players].sort(
    (a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0),
  );
  const topScore = ranked.length ? (totals[ranked[0].id] ?? 0) : 0;

  const heading = isDraw
    ? t("scoring.skullKing.complete.draw")
    : t("scoring.skullKing.complete.winnerWins", {
        name: winner ? displayPlayerName(winner) : "",
      });

  const summary = isDraw
    ? t("scoring.skullKing.complete.drawSummary", {
        score: topScore,
        count: roundsPlayed,
      })
    : t("scoring.skullKing.complete.summary", {
        score: winner ? (totals[winner.id] ?? 0) : 0,
        count: roundsPlayed,
      });

  return (
    <div
      className={`${shared.screen} ${styles.body}`}
      data-testid="sk-match-complete"
    >
      <div className={styles.heading}>
        <div className={shared.caption}>
          {t("scoring.skullKing.complete.caption")}
        </div>
        <h1 className={styles.winnerName} data-testid="sk-winner-name">
          {heading}
        </h1>
        <p className={styles.subtitle}>{summary}</p>
      </div>

      <div className={styles.trophy}>
        <SkullGlyph size={80} crownColor="var(--sk-gold)" />
      </div>

      <div className={styles.standings}>
        <div className={shared.caption}>
          {t("scoring.skullKing.complete.finalStandings")}
        </div>
        {ranked.map((p, i) => {
          const isWinner = !isDraw && winner?.id === p.id;
          const medal = ["🥇", "🥈", "🥉"][i] ?? `#${i + 1}`;
          return (
            <div
              key={p.id}
              className={styles.row}
              data-testid={`sk-final-rank-${i}`}
            >
              <span className={styles.rank}>{medal}</span>
              <span className={`${styles.name} ${isWinner ? styles.winner : ""}`}>
                {displayPlayerName(p)}
              </span>
              <span className={styles.score}>{totals[p.id] ?? 0}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.actions}>
        <Link
          to="/games/$slug"
          params={{ slug: gameSlug }}
          className={shared.btnSecondary}
          style={{ textDecoration: "none", textAlign: "center" }}
          data-testid="back-to-game"
        >
          {t("scoring.skullKing.complete.backCta")}
        </Link>
        <Link
          to="/games/$slug/new"
          params={{ slug: gameSlug }}
          className={shared.btnPrimary}
          style={{ textDecoration: "none", textAlign: "center" }}
          data-testid="sk-rematch"
        >
          {t("scoring.skullKing.complete.rematchCta")}
        </Link>
      </div>
    </div>
  );
}
