import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { computeTotalsByPlayer } from "../../../shared/scoring/7-wonders-duel";
import { parseRoundCategory } from "../../../shared/scoring/skull-king";
import { displayPlayerName } from "../../../shared/players";
import { useOwnedProfileIndex } from "../../hooks/data/useOwnedProfileIndex";
import type { MatchListItem } from "../../hooks/data/useMatchList";
import { Pill } from "../ui/Pill";
import { Icon } from "../ui/Icon";
import styles from "./MatchHistoryRow.module.css";

type ScoreRow = { playerId: string; category: string; value: number };

/** Sum of round_N values per player. Skull King writes one Score row per
 * (player, round_N) with the round's total in `value`, so a flat sum is
 * the match total. */
function computeSkullKingTotalsByPlayer(
  scores: ScoreRow[],
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
  scores: ScoreRow[],
): Record<string, number> {
  if (slug === "skull-king") return computeSkullKingTotalsByPlayer(scores);
  return computeTotalsByPlayer(scores);
}

/**
 * One-row preview of a match, used both on `/games/:slug` (the per-game
 * history list) and on `/players/:profileId` (the recent-matches list
 * under a profile). Two-player matches render a "vs" layout with each
 * side's score; 3+ players collapse to a compact podium row.
 *
 * `gameName` is optional and shown next to the date — useful on the
 * profile page where the list mixes games. The per-game history page
 * already shows the game name in the header so it omits the label.
 */
export function MatchHistoryRow({
  match,
  gameSlug,
  gameName,
  locale,
  viewerId,
}: {
  match: MatchListItem;
  gameSlug: string;
  gameName?: string;
  locale: string;
  /** Drives the "this row represents me" bold styling. Required (even
   * when `null`, e.g. pre-session) so callers can't silently forget
   * it the way they did the old viewerId argument. */
  viewerId: string | null;
}) {
  const { t } = useTranslation();
  const ownedIndex = useOwnedProfileIndex(viewerId ?? undefined);
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
        <div className={styles.matchHeadLeft}>
          {gameName && <span className={styles.matchGame}>{gameName}</span>}
          <span className={styles.matchDate}>{dateText}</span>
        </div>
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
            const isSelf =
              viewerId !== null && p.profile.linkedUserId === viewerId;
            return (
              <Fragment key={p.id}>
                <div
                  className={`${styles.playerCell} ${
                    isWinner ? styles.playerWinner : ""
                  }`}
                  data-self={isSelf || undefined}
                >
                  <span
                    className={[
                      styles.playerName,
                      isWinner && styles.playerNameWinner,
                      isSelf && styles.playerNameSelf,
                      isDim && styles.playerNameDim,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {isWinner && <Icon name="trophy" size={13} />}
                    {displayPlayerName(p, ownedIndex)}
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
            const isSelf =
              viewerId !== null && p.profile.linkedUserId === viewerId;
            return (
              <span
                key={p.id}
                className={`${styles.podiumEntry} ${
                  isWinner ? styles.podiumWinner : ""
                }`}
                data-self={isSelf || undefined}
              >
                <span className={styles.podiumRank}>#{idx + 1}</span>
                <span
                  className={[
                    styles.podiumName,
                    isWinner && styles.playerNameWinner,
                    isSelf && styles.podiumNameSelf,
                    isDim && styles.playerNameDim,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-testid={`match-history-score-${p.id}`}
                  data-score={totals[p.id] ?? 0}
                >
                  {displayPlayerName(p, ownedIndex)}
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
