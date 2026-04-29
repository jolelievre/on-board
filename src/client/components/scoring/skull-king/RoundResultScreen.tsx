import { useTranslation } from "react-i18next";
import shared from "./shared.module.css";
import styles from "./RoundResultScreen.module.css";
import { DigitGrid } from "../../ui/sk/DigitGrid";
import {
  BlackFlag,
  ColorCardChip,
  MermaidGlyph,
  PirateGlyph,
  SkullGlyph,
} from "../../ui/sk/SkGlyphs";
import { displayPlayerName } from "../../../../shared/players";
import {
  EMPTY_SK_ROUND,
  SK_BONUS_MAX,
  scoreSkullKingRound,
  type SkullKingBonusKey,
  type SkullKingRoundEntry,
} from "../../../../shared/scoring/skull-king";
import type { Player } from "../../../types/match";

type Props = {
  round: number;
  players: Player[];
  bids: Record<string, number | undefined>;
  /** Per-player round entries so far. Missing entries default to EMPTY_SK_ROUND. */
  entries: Record<string, SkullKingRoundEntry | undefined>;
  cumulativeBefore: Record<string, number>;
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onChange: (playerId: string, entry: SkullKingRoundEntry) => void;
  onSubmit: () => void;
};

/**
 * Round result entry — tricks won (digit grid) + bonuses (mixed: counter
 * chips for stackables, toggle chips for one-shots) + live score breakdown.
 */
export function RoundResultScreen({
  round,
  players,
  bids,
  entries,
  cumulativeBefore,
  activeIndex,
  onActiveIndexChange,
  onChange,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const active = players[activeIndex];
  if (!active) return null;

  const entry = entries[active.id] ?? EMPTY_SK_ROUND;
  const bid = bids[active.id] ?? 0;

  const trickSum = players.reduce(
    (sum, p) => sum + (entries[p.id]?.tricks ?? 0),
    0,
  );

  const update = (patch: Partial<SkullKingRoundEntry>) => {
    onChange(active.id, { ...entry, ...patch });
  };

  const cycleCounter = (key: SkullKingBonusKey) => {
    const max = SK_BONUS_MAX[key];
    const current = entry[key];
    update({ [key]: (current + 1) % (max + 1) } as Partial<SkullKingRoundEntry>);
  };

  const score = scoreSkullKingRound(round, entry);
  const cum = (cumulativeBefore[active.id] ?? 0) + score.total;

  const breakdownLine = (() => {
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    if (bid === 0) {
      return entry.tricks === 0
        ? t("scoring.skullKing.result.bidZeroMade", { score: sign(score.base) })
        : t("scoring.skullKing.result.bidZeroFailed", { score: sign(score.base) });
    }
    return bid === entry.tricks
      ? t("scoring.skullKing.result.bidMade", { bid, score: sign(score.base) })
      : t("scoring.skullKing.result.bidMissed", { bid, score: sign(score.base) });
  })();

  const isLast = activeIndex === players.length - 1;
  const nextPlayer = !isLast ? players[activeIndex + 1] : null;

  return (
    <div className={`${shared.screen} ${styles.body}`} data-testid="sk-result">
      <div className={styles.scroll}>
        <div className={styles.headerStrip}>
          <span className={styles.playerName}>{displayPlayerName(active)}</span>
          <span className={styles.bidPair}>
            <span className={styles.label}>
              {t("scoring.skullKing.result.bidLabel")}
            </span>
            <span className={styles.value}>{bid}</span>
          </span>
        </div>

        <div>
          <p className={styles.tricksLabel}>
            {t("scoring.skullKing.result.tricksLabel", {
              sum: trickSum,
              round,
            })}
          </p>
          <DigitGrid
            max={round}
            selected={entry.tricks}
            onPick={(n) => update({ tricks: n })}
            data-testid="sk-result-tricks"
          />
        </div>

        <hr className={shared.dashedRule} />

        <div className={shared.caption} style={{ marginBottom: 8 }}>
          {t("scoring.skullKing.result.bonusesLabel")}
        </div>

        {/* Counters: 14s held, mermaid by pirate, pirate by SK */}
        <div className={styles.bonusGrid}>
          <CounterChip
            icon={
              <span style={{ display: "flex", gap: 2 }}>
                <ColorCardChip variant="yellow" size={20} />
                <ColorCardChip variant="green" size={20} />
                <ColorCardChip variant="purple" size={20} />
              </span>
            }
            label={t("scoring.skullKing.bonus.color14Label")}
            hint={t("scoring.skullKing.bonus.color14Hint")}
            count={entry.color14}
            accent="var(--sk-gold)"
            onTap={() => cycleCounter("color14")}
            testId="sk-bonus-color14"
          />
          <CounterChip
            icon={<MermaidGlyph size={32} />}
            label={t("scoring.skullKing.bonus.mermaidByPirateLabel")}
            hint={t("scoring.skullKing.bonus.mermaidByPirateHint")}
            count={entry.mermaidByPirate}
            accent="var(--sk-sea)"
            onTap={() => cycleCounter("mermaidByPirate")}
            testId="sk-bonus-mermaidByPirate"
          />
          <CounterChip
            icon={<PirateGlyph size={32} />}
            label={t("scoring.skullKing.bonus.pirateBySkLabel")}
            hint={t("scoring.skullKing.bonus.pirateBySkHint")}
            count={entry.pirateBySK}
            accent="var(--sk-blood)"
            onTap={() => cycleCounter("pirateBySK")}
            testId="sk-bonus-pirateBySK"
          />
        </div>

        {/* Toggles: black 14, SK by mermaid */}
        <div className={styles.bonusGrid2}>
          <ToggleChip
            icon={<BlackFlag size={28} />}
            label={t("scoring.skullKing.bonus.black14Label")}
            hint={t("scoring.skullKing.bonus.black14Hint")}
            on={entry.black14 === 1}
            accent="var(--sk-black)"
            onToggle={(v) => update({ black14: v ? 1 : 0 })}
            testId="sk-bonus-black14"
          />
          <ToggleChip
            icon={<SkullGlyph size={32} />}
            label={t("scoring.skullKing.bonus.skByMermaidLabel")}
            hint={t("scoring.skullKing.bonus.skByMermaidHint")}
            on={entry.skByMermaid === 1}
            accent="var(--sk-sea-deep)"
            onToggle={(v) => update({ skByMermaid: v ? 1 : 0 })}
            testId="sk-bonus-skByMermaid"
          />
        </div>

        <hr className={shared.dashedRule} />

        <div className={styles.breakdown} data-testid="sk-score-breakdown">
          <div className={styles.breakdownTop}>
            <span className={shared.caption}>
              {t("scoring.skullKing.result.roundScoreLabel")}
            </span>
            <span
              className={`${styles.breakdownTotal} ${
                score.total >= 0 ? styles.positive : styles.negative
              }`}
              data-testid="sk-round-total"
            >
              {score.total >= 0 ? "+" : ""}
              {score.total}
            </span>
          </div>
          <div className={styles.breakdownLine}>
            {breakdownLine}
            {score.bonus > 0 &&
              ` · ${t("scoring.skullKing.result.bonusInline", {
                points: score.bonus,
              })}`}
          </div>
          <div className={styles.breakdownCum}>
            <span className={shared.caption}>
              {t("scoring.skullKing.result.totalAfterRound", { n: round })}
            </span>
            <span
              className={styles.breakdownCumValue}
              data-testid="sk-cumulative-total"
            >
              {cum}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={`${shared.btnSecondary} ${styles.prev}`}
          onClick={() => onActiveIndexChange(Math.max(0, activeIndex - 1))}
          disabled={activeIndex === 0}
          data-testid="sk-result-prev"
        >
          {t("scoring.skullKing.result.prevPlayer")}
        </button>
        {nextPlayer ? (
          <button
            type="button"
            className={`${shared.btnPrimary} ${styles.next}`}
            onClick={() => onActiveIndexChange(activeIndex + 1)}
            data-testid="sk-result-next"
          >
            {t("scoring.skullKing.result.nextPlayer", {
              name: displayPlayerName(nextPlayer),
            })}
          </button>
        ) : (
          <button
            type="button"
            className={`${shared.btnPrimary} ${styles.next}`}
            onClick={onSubmit}
            data-testid="sk-result-end-round"
          >
            {t("scoring.skullKing.result.endRound")}
          </button>
        )}
      </div>
    </div>
  );
}

function CounterChip({
  icon,
  label,
  hint,
  count,
  accent,
  onTap,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  count: number;
  accent: string;
  onTap: () => void;
  testId: string;
}) {
  const isActive = count > 0;
  return (
    <button
      type="button"
      className={`${styles.chip} ${isActive ? styles.active : ""}`}
      style={{ ["--accent" as string]: accent }}
      onClick={onTap}
      data-testid={testId}
      data-count={count}
    >
      <span className={styles.chipIcon}>{icon}</span>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipHint}>{hint}</span>
      {count >= 1 && <span className={styles.badge}>{count}</span>}
    </button>
  );
}

function ToggleChip({
  icon,
  label,
  hint,
  on,
  accent,
  onToggle,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  on: boolean;
  accent: string;
  onToggle: (v: boolean) => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.chip} ${on ? styles.active : ""}`}
      style={{ ["--accent" as string]: accent }}
      onClick={() => onToggle(!on)}
      data-testid={testId}
      data-on={on ? "true" : "false"}
      aria-pressed={on}
    >
      <span className={styles.chipIcon}>{icon}</span>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipHint}>{hint}</span>
      {on && <span className={styles.badge}>✓</span>}
    </button>
  );
}
