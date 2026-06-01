import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import shared from "./shared.module.css";
import styles from "./MatchCompleteScreen.module.css";
import { Avatar } from "../../ui/Avatar";
import { SkullGlyph } from "../../ui/sk/SkGlyphs";
import { displayPlayerName } from "../../../../shared/players";
import { useAuthSession } from "../../../hooks/useAuthSession";
import { useOwnedProfileIndex } from "../../../hooks/data/useOwnedProfileIndex";
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
  /** Id of the just-finished match. Forwarded to the new-match form as
   * `?rematchOf=` so it can prefill players + dealer for the rematch. */
  matchId: string;
  roundsPlayed: number;
  /** Opens the round-by-round scoreboard overlay. Same component as the
   * in-match toggle. */
  onOpenScoreboard?: () => void;
};

export function MatchCompleteScreen({
  players,
  totals,
  winner,
  isDraw,
  gameSlug,
  matchId,
  roundsPlayed,
  onOpenScoreboard,
}: Props) {
  const { t } = useTranslation();
  const { session } = useAuthSession();
  const viewerId = session?.user.id ?? null;
  const ownedIndex = useOwnedProfileIndex(viewerId);
  const ranked = [...players].sort(
    (a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0),
  );
  const topScore = ranked.length ? (totals[ranked[0].id] ?? 0) : 0;

  const heading = isDraw
    ? t("scoring.skullKing.complete.draw")
    : t("scoring.skullKing.complete.winnerWins", {
        name: winner ? displayPlayerName(winner, ownedIndex) : "",
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
        {winner && !isDraw ? (
          <Avatar
            profile={winner.profile}
            viewerId={viewerId}
            size="xl"
            winner
          />
        ) : (
          <SkullGlyph size={80} crownColor="var(--sk-gold)" />
        )}
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
              <Avatar
                profile={p.profile}
                viewerId={viewerId}
                size="md"
              />
              <span className={`${styles.name} ${isWinner ? styles.winner : ""}`}>
                {displayPlayerName(p, ownedIndex)}
              </span>
              <span className={styles.score}>{totals[p.id] ?? 0}</span>
            </div>
          );
        })}
      </div>

      {onOpenScoreboard && (
        <button
          type="button"
          className={shared.btnSecondary}
          onClick={onOpenScoreboard}
          data-testid="sk-complete-open-scoreboard"
          style={{ width: "100%" }}
        >
          {t("scoring.skullKing.complete.viewScoreboardCta")}
        </button>
      )}

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
          search={{ rematchOf: matchId }}
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
