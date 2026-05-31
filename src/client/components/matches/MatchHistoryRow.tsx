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
 * One-row preview of a match (Phase 7 design refactor). Used on both
 * `/games/:slug` (the per-game history list) and `/players/:profileId`
 * (the recent-matches list under a profile). Two layouts by player
 * count, sharing a common header (game glyph + date) and "me"
 * highlight scheme.
 *
 * - **2 players** (e.g. 7 Wonders Duel): symmetric `avatar — VS —
 *   avatar`. Winner side gets the gold `WinnerBadge` + accent score.
 *   Centered `VsMark` with the date beneath.
 * - **3+ players** (e.g. Skull King): winner leads (avatar + crown +
 *   name), then "beat" + an overlapping stack of the other players'
 *   avatars (cap 4 then `+N`), with the winner's score + date on the
 *   right.
 *
 * `viewerId` powers the "this is me" treatment: a teal edge tab on the
 * row, a `Highlighter` swipe behind my name, and a teal ring on my
 * avatar. Pass `null` (used on `/players/:profileId`) to suppress —
 * every row there is already that person, so highlighting is noise.
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
  /** The viewer (signed-in user) for the me-highlight, or null to
   * suppress (e.g. on a profile-detail page). */
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

  // "This is me" — link the row to the signed-in user via the embedded
  // profile's `linkedUserId`. When `viewerId === null` (profile page),
  // every check returns false, so no row is highlighted.
  const isMe = (player: Player): boolean =>
    viewerId !== null && player.profile.linkedUserId === viewerId;

  // Multi-player rows sort by score (leader first), 2-player rows keep
  // position order for the symmetric VS layout.
  const orderedPlayers = compact
    ? match.players
    : [...match.players].sort(
        (a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0),
      );

  // Row gets the teal edge tab when the signed-in user is one of the
  // match's players.
  const rowHasMe = match.players.some(isMe);

  const gameGlyph = renderGameGlyph(gameSlug);

  return (
    <Link
      to="/matches/$id"
      params={{ id: match.id }}
      data-testid={`match-history-row-${match.id}`}
      // `data-me` lets E2E assert the me-highlight is applied without
      // poking at CSS module class names (those are hashed at build time).
      data-me={rowHasMe || undefined}
      className={`${styles.matchCard} ${rowHasMe ? styles.matchCardMe : ""}`}
    >
      {compact ? (
        <TwoPlayerLayout
          players={orderedPlayers}
          winnerId={winner?.id ?? null}
          totals={totals}
          isCompleted={isCompleted}
          isMe={isMe}
          ownedIndex={ownedIndex}
          dateText={dateText}
          gameGlyph={gameGlyph}
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
          gameGlyph={gameGlyph}
          gameName={gameName}
          beatLabel={t("matches.history.beat")}
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

/** Per-game leading glyph. Reuses existing primitives — no new game
 * needs new icons here, just a new entry in the switch. */
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
  gameGlyph: React.ReactNode;
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
  gameGlyph,
  inProgressLabel,
}: LayoutCommon) {
  const [left, right] = players;
  if (!left || !right) return null;

  return (
    <div className={styles.twoPlayerRoot}>
      <span className={styles.gameGlyph} aria-hidden="true">
        {gameGlyph}
      </span>

      <TwoPlayerSide
        player={left}
        score={totals[left.id] ?? 0}
        isWinner={winnerId === left.id}
        isDim={isCompleted && winnerId !== null && winnerId !== left.id}
        isMe={isMe(left)}
        ownedIndex={ownedIndex}
      />

      <div className={styles.vsBlock}>
        <VsMark size={32} />
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
          // The me-highlight forces the teal accent ring regardless of
          // the profile's own stamp ring choice, so the viewer can spot
          // themselves at a glance. Stamps still show on every other
          // avatar in the row.
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
  beatLabel: string;
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
  gameGlyph,
  gameName,
  beatLabel,
  moreCountLabel,
  inProgressLabel,
}: MultiProps) {
  // First player in `players` is the leader (sorted by score in the
  // parent). When there's a confirmed winner, that's the same person —
  // we use the explicit `winnerId` to drive the crown badge so an
  // in-progress match doesn't pre-crown the current leader.
  const [leader, ...others] = players;
  if (!leader) return null;
  const isWinner = winnerId === leader.id;
  const leaderName = displayPlayerName(leader, ownedIndex);

  const visibleOthers = others.slice(0, 4);
  const extraCount = others.length - visibleOthers.length;

  return (
    <div className={styles.multiRoot}>
      <span className={styles.gameGlyph} aria-hidden="true">
        {gameGlyph}
      </span>

      <span className={styles.multiLeader} data-self={isMe(leader) || undefined}>
        <span className={styles.avatarWrap}>
          <Avatar
            profile={leader.profile}
            size="md"
            ring={isMe(leader) ? null : undefined}
            className={isMe(leader) ? styles.meRing : undefined}
          />
          {isWinner && <WinnerBadge overlay size={20} />}
        </span>
        <span className={styles.nameWrap}>
          {isMe(leader) && <Highlighter />}
          <span
            className={styles.nameText}
            data-testid={`match-history-score-${leader.id}`}
            data-score={totals[leader.id] ?? 0}
          >
            {leaderName}
          </span>
        </span>
      </span>

      <span className={styles.beat}>{beatLabel}</span>

      <span className={styles.stack}>
        {visibleOthers.map((p, idx) => (
          <span
            key={p.id}
            className={styles.stackItem}
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
          <span className={styles.stackOverflow}>
            {moreCountLabel(extraCount)}
          </span>
        )}
      </span>

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
