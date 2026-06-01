import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { computeTotalsByPlayer } from "../../../shared/scoring/7-wonders-duel";
import { parseRoundCategory } from "../../../shared/scoring/skull-king";
import { displayPlayerName } from "../../../shared/players";
import { useOwnedProfileIndex } from "../../hooks/data/useOwnedProfileIndex";
import type { MatchListItem } from "../../hooks/data/useMatchList";
import type { Player } from "../../types/match";
import { Avatar } from "../ui/Avatar";
import { CatGlyph } from "../ui/CatGlyph";
import { Highlighter } from "../ui/Highlighter";
import { Icon } from "../ui/Icon";
import { VsMark } from "../ui/VsMark";
import styles from "./MatchHistoryRow.module.css";

type ScoreRow = { playerId: string; category: string; value: number };

/** Sum of round_N values per player. */
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
 * One-row preview of a match (Phase 7 design refactor, revised).
 *
 * Two layouts share a card body with the game glyph floated in the
 * top-left corner — it's a label, not part of the row content, so the
 * two name blocks (2-player) or the leader name (3+) get the full
 * width.
 *
 * - **2 players**: symmetric `avatar + name+score | VsMark+date |
 *   name+score + avatar`. Both sides take equal width.
 * - **3+ players**: bigger winner avatar on the left; winner name
 *   anchored to its top-right; a smaller row of the other players'
 *   avatars beneath the name (cap 4, then `+N`). The score + date
 *   stack on the right.
 *
 * Pass `viewerId` to drive the teal edge tab + Highlighter swipe +
 * accent avatar ring "me" treatment. The original design rule that
 * suppressed it on profile-detail surfaces was relaxed during the
 * feedback round — both surfaces now share the same visual.
 */
export function MatchHistoryRow({
  match,
  gameSlug,
  locale,
  viewerId,
  showGameGlyph = true,
}: {
  match: MatchListItem;
  gameSlug: string;
  locale: string;
  /** When true (the default), the floating game-glyph sticker
   * appears in the top-left corner. Pass `false` on the per-game
   * history page where the surrounding context already tells the
   * viewer which game these matches belong to. */
  showGameGlyph?: boolean;
  viewerId: string;
}) {
  const { t } = useTranslation();
  const ownedIndex = useOwnedProfileIndex(viewerId);
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

  const isMe = (player: Player): boolean =>
    player.profile.linkedUserId === viewerId;

  const orderedPlayers = compact
    ? match.players
    : [...match.players].sort(
        (a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0),
      );

  const rowHasMe = match.players.some(isMe);
  const gameGlyph = showGameGlyph ? renderGameGlyph(gameSlug) : null;

  return (
    <Link
      to="/matches/$id"
      params={{ id: match.id }}
      data-testid={`match-history-row-${match.id}`}
      data-me={rowHasMe || undefined}
      className={`${styles.matchCard} ${rowHasMe ? styles.matchCardMe : ""}`}
    >
      {/* Floating game glyph — top-left corner of the card. Takes no
          layout space inside the row so the name blocks below get the
          full width. Suppressed via `showGameGlyph={false}` on the
          per-game history page (the page header already names the
          game). */}
      {gameGlyph && (
        <span className={styles.gameGlyph} aria-hidden="true">
          {gameGlyph}
        </span>
      )}

      {/* Floating "in progress" badge — top-right corner. Smaller
          than a full Pill so the VS / multi layouts get back the
          horizontal space the wide pill used to consume. */}
      {!isCompleted && (
        <span className={styles.inProgressBadge}>
          {t("matches.history.inProgress")}
        </span>
      )}

      {compact ? (
        <TwoPlayerLayout
          players={orderedPlayers}
          winnerId={winner?.id ?? null}
          totals={totals}
          isCompleted={isCompleted}
          isMe={isMe}
          ownedIndex={ownedIndex}
          dateText={dateText}
          viewerId={viewerId}
        />
      ) : (
        <MultiPlayerLayout
          players={orderedPlayers}
          winnerId={winner?.id ?? null}
          totals={totals}
          isCompleted={isCompleted}
          isMe={isMe}
          ownedIndex={ownedIndex}
          dateText={dateText}
          viewerId={viewerId}
          moreCountLabel={(extra: number) =>
            t("matches.history.moreCount", { count: extra })
          }
        />
      )}
    </Link>
  );
}

function renderGameGlyph(slug: string) {
  if (slug === "7-wonders-duel") {
    return <CatGlyph id="wonders" size={20} />;
  }
  if (slug === "skull-king") {
    return <Icon name="skull-king" size={22} />;
  }
  return <Icon name="dice" size={20} />;
}

type LayoutCommon = {
  players: Player[];
  winnerId: string | null;
  totals: Record<string, number>;
  isCompleted: boolean;
  isMe: (player: Player) => boolean;
  ownedIndex: ReturnType<typeof useOwnedProfileIndex>;
  dateText: string;
  /** Threaded into every `<Avatar>` so `displayProfileAvatar` can
   * route through the viewer's own profile when the row points at
   * them. */
  viewerId: string;
};

function TwoPlayerLayout({
  players,
  winnerId,
  totals,
  isCompleted,
  isMe,
  ownedIndex,
  dateText,
  viewerId,
}: LayoutCommon) {
  const [left, right] = players;
  if (!left || !right) return null;
  return (
    <div className={styles.twoPlayerRoot}>
      <TwoPlayerSide
        player={left}
        score={totals[left.id] ?? 0}
        isWinner={winnerId === left.id}
        isDim={isCompleted && winnerId !== null && winnerId !== left.id}
        isMe={isMe(left)}
        ownedIndex={ownedIndex}
        viewerId={viewerId}
      />
      <VsMark size={32} className={styles.vsMark} />
      <TwoPlayerSide
        player={right}
        score={totals[right.id] ?? 0}
        isWinner={winnerId === right.id}
        isDim={isCompleted && winnerId !== null && winnerId !== right.id}
        isMe={isMe(right)}
        ownedIndex={ownedIndex}
        viewerId={viewerId}
        align="right"
      />
      {/* Date is absolutely positioned (relative to `.matchCard`) so
          it doesn't add to the row's height — the VS mark stays
          exactly on the avatar centre line. */}
      <span className={styles.vsDate}>{dateText}</span>
    </div>
  );
}

type SideProps = {
  player: Player;
  score: number;
  isWinner: boolean;
  isDim: boolean;
  isMe: boolean;
  ownedIndex: ReturnType<typeof useOwnedProfileIndex>;
  viewerId: string;
  align?: "left" | "right";
};

function TwoPlayerSide({
  player,
  score,
  isWinner,
  isDim,
  isMe,
  ownedIndex,
  viewerId,
  align = "left",
}: SideProps) {
  const name = displayPlayerName(player, ownedIndex);
  return (
    <div
      className={`${styles.side} ${align === "right" ? styles.sideRight : ""}`}
      data-self={isMe || undefined}
    >
      <Avatar
        profile={player.profile}
        viewerId={viewerId}
        size="md"
        winner={isWinner}
        // `.vsAvatar` bumps the avatar to 48px — same as the
        // multi-player leader — so both row variants share a
        // visual scale. The me-highlight relies on the row's edge
        // tab + the Highlighter swipe behind the name; the avatar
        // wears its own stamp ring even on the viewer's row, so the
        // viewer's chosen colour comes through.
        className={styles.vsAvatar}
      />
      <span className={styles.sideMeta}>
        <span
          className={`${styles.nameWrap} ${isDim ? styles.nameWrapDim : ""}`}
        >
          {isMe && <Highlighter />}
          <span className={styles.nameText} data-testid={`name-${player.id}`}>
            {name}
          </span>
        </span>
        <span
          className={`${styles.score} ${
            isWinner ? styles.scoreWinner : ""
          } ${isDim ? styles.scoreDim : ""}`}
          data-testid={`match-history-score-${player.id}`}
        >
          {score}
        </span>
      </span>
    </div>
  );
}

type MultiProps = LayoutCommon & {
  moreCountLabel: (extra: number) => string;
};

function MultiPlayerLayout({
  players,
  winnerId,
  totals,
  isCompleted,
  isMe,
  ownedIndex,
  dateText,
  moreCountLabel,
  viewerId,
}: MultiProps) {
  const [leader, ...others] = players;
  if (!leader) return null;
  const isWinner = winnerId === leader.id;
  const leaderName = displayPlayerName(leader, ownedIndex);
  const visibleOthers = others.slice(0, 4);
  const extraCount = others.length - visibleOthers.length;

  return (
    <div className={styles.multiRoot}>
      {/* Left column: winner avatar. `md` matches the VS layout so
          both surface types share one face size; the crown badge +
          name position establish "winner" instead of bigger photo. */}
      <Avatar
        profile={leader.profile}
        viewerId={viewerId}
        size="md"
        winner={isWinner}
        // Stamp ring stays the owner's choice even on the viewer's
        // own row — the me-highlight signals identity through the
        // edge tab + Highlighter swipe instead of repainting the
        // ring colour.
        className={styles.multiLeaderAvatar}
      />

      {/* Centre column: leader name (top), stack of other players
          (under the name). The stack avatars stay small (sm) so the
          eye lands on the leader first. */}
      <span className={styles.multiCentre}>
        <span className={styles.multiName}>
          {isMe(leader) && <Highlighter />}
          <span
            className={styles.multiNameText}
            data-testid={`match-history-score-${leader.id}`}
            data-score={totals[leader.id] ?? 0}
          >
            {leaderName}
          </span>
        </span>
        <span className={styles.othersStack}>
          {visibleOthers.map((p, idx) => (
            <span
              key={p.id}
              className={styles.othersItem}
              style={{ zIndex: visibleOthers.length - idx }}
              data-self={isMe(p) || undefined}
            >
              <Avatar
                profile={p.profile}
                viewerId={viewerId}
                // Stack avatars sized smaller than the leader so the
                // "winner + supporting cast" hierarchy reads at a
                // glance. `size="md"` + a CSS class that nudges the
                // avatar-size variable keeps the stack visibly under
                // the leader's 48px while staying above the previous
                // too-tiny sm (24). Stamp ring stays the owner's
                // choice; me-highlight is conveyed by the row's edge
                // tab + Highlighter, not by overriding the ring.
                size="md"
                className={styles.multiStackAvatar}
              />
              {/* Visually hidden alias — keeps the name in the row's
                  accessibility tree (each face is otherwise just an
                  unlabelled icon), in the DOM `textContent` for
                  Playwright `toContainText` assertions, and in the
                  screen-reader pass for the multi-player row. */}
              <span className={styles.srOnly}>
                {displayPlayerName(p, ownedIndex)}
              </span>
            </span>
          ))}
          {extraCount > 0 && (
            <span className={styles.othersOverflow}>
              {moreCountLabel(extraCount)}
            </span>
          )}
        </span>
      </span>

      {/* Right column: leader's score (only when completed). The
          "in progress" badge floats from the matchCard's top-right
          corner; the date is positioned absolutely at the
          bottom-right of the card (see `.multiDate`) so it doesn't
          stretch the score column. */}
      <span className={styles.multiMeta}>
        {isCompleted && (
          <span className={styles.multiScore}>{totals[leader.id] ?? 0}</span>
        )}
      </span>
      <span className={styles.multiDate}>{dateText}</span>
    </div>
  );
}
