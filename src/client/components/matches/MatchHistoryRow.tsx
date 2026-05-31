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
import { Pill } from "../ui/Pill";
import { VsMark } from "../ui/VsMark";
import { WinnerBadge } from "../ui/WinnerBadge";
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
  gameName,
  locale,
  viewerId,
}: {
  match: MatchListItem;
  gameSlug: string;
  gameName?: string;
  locale: string;
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

  const isMe = (player: Player): boolean =>
    viewerId !== null && player.profile.linkedUserId === viewerId;

  const orderedPlayers = compact
    ? match.players
    : [...match.players].sort(
        (a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0),
      );

  const rowHasMe = match.players.some(isMe);
  const gameGlyph = renderGameGlyph(gameSlug);

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
          full width. */}
      <span className={styles.gameGlyph} aria-hidden="true">
        {gameGlyph}
      </span>

      {compact ? (
        <TwoPlayerLayout
          players={orderedPlayers}
          winnerId={winner?.id ?? null}
          totals={totals}
          isCompleted={isCompleted}
          isMe={isMe}
          ownedIndex={ownedIndex}
          dateText={dateText}
          inProgressLabel={
            !isCompleted ? t("matches.history.inProgress") : null
          }
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
          gameName={gameName}
          moreCountLabel={(extra: number) =>
            t("matches.history.moreCount", { count: extra })
          }
          inProgressLabel={
            !isCompleted ? t("matches.history.inProgress") : null
          }
        />
      )}
    </Link>
  );
}

function renderGameGlyph(slug: string) {
  if (slug === "7-wonders-duel") {
    return <CatGlyph id="wonders" size={16} />;
  }
  if (slug === "skull-king") {
    return <Icon name="skull-king" size={18} />;
  }
  return <Icon name="dice" size={16} />;
}

type LayoutCommon = {
  players: Player[];
  winnerId: string | null;
  totals: Record<string, number>;
  isCompleted: boolean;
  isMe: (player: Player) => boolean;
  ownedIndex: ReturnType<typeof useOwnedProfileIndex>;
  dateText: string;
  inProgressLabel: string | null;
};

function TwoPlayerLayout({
  players,
  winnerId,
  totals,
  isCompleted,
  isMe,
  ownedIndex,
  dateText,
  inProgressLabel,
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
      />
      <div className={styles.vsBlock}>
        <VsMark size={30} />
        <span className={styles.vsDate}>{dateText}</span>
        {inProgressLabel && (
          <Pill tone="warning">{inProgressLabel}</Pill>
        )}
      </div>
      <TwoPlayerSide
        player={right}
        score={totals[right.id] ?? 0}
        isWinner={winnerId === right.id}
        isDim={isCompleted && winnerId !== null && winnerId !== right.id}
        isMe={isMe(right)}
        ownedIndex={ownedIndex}
        align="right"
      />
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
  align?: "left" | "right";
};

function TwoPlayerSide({
  player,
  score,
  isWinner,
  isDim,
  isMe,
  ownedIndex,
  align = "left",
}: SideProps) {
  const name = displayPlayerName(player, ownedIndex);
  return (
    <div
      className={`${styles.side} ${align === "right" ? styles.sideRight : ""}`}
      data-self={isMe || undefined}
    >
      <span className={styles.avatarWrap}>
        <Avatar
          profile={player.profile}
          size="md"
          ring={isMe ? null : undefined}
          className={isMe ? styles.meRing : undefined}
        />
        {isWinner && <WinnerBadge overlay size={20} />}
      </span>
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
  gameName?: string;
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
  gameName,
  moreCountLabel,
  inProgressLabel,
}: MultiProps) {
  const [leader, ...others] = players;
  if (!leader) return null;
  const isWinner = winnerId === leader.id;
  const leaderName = displayPlayerName(leader, ownedIndex);
  const visibleOthers = others.slice(0, 4);
  const extraCount = others.length - visibleOthers.length;

  return (
    <div className={styles.multiRoot}>
      {/* Left column: big winner avatar (lg-ish). The crown overlays
          its top-right when a winner has been declared (or it's a
          live leader). */}
      <span className={styles.multiAvatarWrap}>
        <Avatar
          profile={leader.profile}
          size="lg"
          ring={isMe(leader) ? null : undefined}
          className={isMe(leader) ? styles.meRing : undefined}
        />
        {isWinner && <WinnerBadge overlay size={24} />}
      </span>

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
                size="sm"
                ring={isMe(p) ? null : undefined}
                className={isMe(p) ? styles.meRing : undefined}
              />
            </span>
          ))}
          {extraCount > 0 && (
            <span className={styles.othersOverflow}>
              {moreCountLabel(extraCount)}
            </span>
          )}
        </span>
      </span>

      {/* Right column: score (when completed) + date stacked. */}
      <span className={styles.multiMeta}>
        {inProgressLabel ? (
          <Pill tone="warning">{inProgressLabel}</Pill>
        ) : isCompleted ? (
          <span className={styles.multiScore}>{totals[leader.id] ?? 0}</span>
        ) : null}
        <span className={styles.multiDate}>
          {gameName ? `${gameName} · ${dateText}` : dateText}
        </span>
      </span>
    </div>
  );
}
