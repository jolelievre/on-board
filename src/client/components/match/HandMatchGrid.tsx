import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import { SketchRect } from "../ui/SketchRect";
import { SketchUnderline } from "../ui/SketchUnderline";
import { CatGlyph } from "../ui/CatGlyph";
import { jp } from "../ui/sketch";
import {
  categoryColor,
  categoryFromScoringId,
  type Category,
} from "../ui/category";
import {
  SEVEN_WONDERS_CATEGORIES,
  categoryToVictoryPoints,
  computePlayerTotal,
  type SevenWondersCategoryKey,
} from "../../../shared/scoring/7-wonders-duel";
import styles from "./match-grid.module.css";

export type ScoreGridPlayer = { id: string; name: string };

export type ScoreGridValues = Record<
  string,
  Partial<Record<SevenWondersCategoryKey, number>>
>;

export type SupremacyType = "military_supremacy" | "scientific_supremacy";

export type SupremacySelection = {
  type: SupremacyType;
  playerId: string;
} | null;

type Props = {
  players: ScoreGridPlayer[];
  values: ScoreGridValues;
  onChange: (
    playerId: string,
    category: SevenWondersCategoryKey,
    value: number,
  ) => void;
  supremacy: SupremacySelection;
  onSupremacyChange: (next: SupremacySelection) => void;
  disabled?: boolean;
  /** ID of the winning player (if completed). Highlights total cell. */
  winnerId?: string | null;
};

function rowTemplate(playerCount: number) {
  return `54px ${"1fr ".repeat(playerCount).trim()}`;
}

function parseInput(raw: string): number {
  if (raw === "" || raw === "-") return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : n;
}

export function HandMatchGrid({
  players,
  values,
  onChange,
  supremacy,
  onSupremacyChange,
  disabled,
  winnerId,
}: Props) {
  const { t } = useTranslation();
  const template = rowTemplate(players.length);

  const totals = players.map((p) => {
    const playerScores = SEVEN_WONDERS_CATEGORIES.map((c) => ({
      category: c.key,
      value: values[p.id]?.[c.key] ?? 0,
    }));
    return { player: p, total: computePlayerTotal(playerScores) };
  });

  const toggleSupremacy = (type: SupremacyType, playerId: string) => {
    if (supremacy?.type === type && supremacy.playerId === playerId) {
      onSupremacyChange(null);
    } else {
      onSupremacyChange({ type, playerId });
    }
  };

  return (
    <div className={styles.grid} data-testid="score-grid">
      {/* Player name row */}
      <div className={styles.row} style={{ gridTemplateColumns: template }}>
        <div aria-hidden />
        {players.map((p, i) => {
          const total = totals[i].total;
          return (
            <PlayerNameCell
              key={p.id}
              player={p}
              total={total}
              tilt={i === 0 ? -0.4 : 0.3}
            />
          );
        })}
      </div>

      {/* Category rows */}
      {SEVEN_WONDERS_CATEGORIES.map((cat, ri) => {
        const visualCat = categoryFromScoringId(cat.key);
        return (
          <div
            key={cat.key}
            className={styles.row}
            style={{ gridTemplateColumns: template }}
          >
            <CategoryIconCell category={visualCat} seedBase={ri} />
            {players.map((p, pi) => {
              const raw = values[p.id]?.[cat.key] ?? 0;
              return (
                <ScoreCell
                  key={p.id}
                  playerId={p.id}
                  category={cat.key}
                  visualCategory={visualCat}
                  value={raw}
                  onChange={onChange}
                  disabled={disabled}
                  seedBase={100 + ri * 10 + pi}
                />
              );
            })}
          </div>
        );
      })}

      {/* Σ separator (heavy double underline) */}
      <div className={styles.totalSeparator}>
        <SketchUnderline
          width={350}
          color="var(--color-ink)"
          seed={9}
          strokeWidth={2.4}
          double
        />
      </div>

      {/* Totals row */}
      <div className={styles.row} style={{ gridTemplateColumns: template }}>
        <div className={styles.sigmaCell}>
          <CatGlyph id="sigma" size={32} />
        </div>
        {totals.map(({ player, total }, i) => (
          <TotalCell
            key={player.id}
            playerId={player.id}
            total={total}
            tilt={i === 0 ? -0.6 : 0.4}
            isWinner={winnerId === player.id}
            seedBase={200 + i}
          />
        ))}
      </div>

      {/* Supremacy section */}
      <div className={styles.supremacySection}>
        <h4 className={styles.supremacyTitle}>
          {t("scoring.sevenWondersDuel.specialVictory.military", {
            defaultValue: "Military supremacy",
          })}
          {" / "}
          {t("scoring.sevenWondersDuel.specialVictory.scientific", {
            defaultValue: "Scientific supremacy",
          })}
        </h4>
        <SupremacyRow
          type="military_supremacy"
          glyphId="military-sup"
          accent="var(--color-cat-military-strong)"
          players={players}
          supremacy={supremacy}
          onToggle={toggleSupremacy}
          disabled={disabled}
          template={template}
        />
        <SupremacyRow
          type="scientific_supremacy"
          glyphId="scientific-sup"
          accent="var(--color-cat-scientific-strong)"
          players={players}
          supremacy={supremacy}
          onToggle={toggleSupremacy}
          disabled={disabled}
          template={template}
        />
      </div>
    </div>
  );
}

function PlayerNameCell({
  player,
  total,
  tilt,
}: {
  player: ScoreGridPlayer;
  total: number;
  tilt: number;
}) {
  const seed = 10 + (player.id.charCodeAt(0) % 100);
  return (
    <div
      className={styles.playerNameCell}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <SketchRect
        width={150}
        height={56}
        stroke="var(--color-ink)"
        fill="var(--color-surface)"
        strokeWidth={2}
        seed={seed}
      />
      <div className={styles.playerNameInner}>
        <div
          className={styles.playerName}
          data-testid={`score-grid-player-${player.id}`}
        >
          {player.name}
        </div>
        <div className={styles.playerTotal}>{total} pts</div>
      </div>
    </div>
  );
}

function CategoryIconCell({
  category,
  seedBase,
}: {
  category: Category | null;
  seedBase: number;
}) {
  if (!category) {
    return <div className={styles.iconCell} />;
  }
  const stroke = categoryColor(category, "strong");
  const tilt = jp(seedBase * 7, 0.8);
  const seed = 50 + seedBase;
  return (
    <div
      className={styles.iconCell}
      style={
        {
          transform: `rotate(${tilt.toFixed(2)}deg)`,
          ["--cat-strong" as string]: stroke,
        } as CSSProperties
      }
    >
      <span className={styles.iconBox}>
        <SketchRect
          width={48}
          height={42}
          stroke={stroke}
          fill="transparent"
          strokeWidth={1.8}
          seed={seed}
        />
        <CatGlyph id={category} size={24} color="currentColor" />
      </span>
    </div>
  );
}

type ScoreCellProps = {
  playerId: string;
  category: SevenWondersCategoryKey;
  visualCategory: Category | null;
  value: number;
  onChange: Props["onChange"];
  disabled?: boolean;
  seedBase: number;
};

function ScoreCell({
  playerId,
  category,
  visualCategory,
  value,
  onChange,
  disabled,
  seedBase,
}: ScoreCellProps) {
  const { t } = useTranslation();
  const isZero = !value;
  const tilt = jp(seedBase, 0.6);
  const stroke = visualCategory
    ? categoryColor(visualCategory, "strong")
    : "var(--color-ink-faint)";
  const ink = visualCategory
    ? categoryColor(visualCategory, "ink")
    : "var(--color-ink)";
  const fill = isZero
    ? "transparent"
    : visualCategory
      ? `color-mix(in srgb, ${categoryColor(visualCategory, "bg")} 70%, var(--color-surface))`
      : "var(--color-surface)";

  const cellStyle = {
    transform: `rotate(${tilt.toFixed(2)}deg)`,
    ["--cat-strong" as string]: stroke,
    ["--cat-ink" as string]: ink,
  } as CSSProperties;

  const showTreasuryHint = category === "treasury" && value > 0;
  const treasuryVp = showTreasuryHint
    ? categoryToVictoryPoints("treasury", value)
    : 0;

  return (
    <div className={styles.cell} style={cellStyle}>
      <SketchRect
        width={150}
        height={42}
        stroke={isZero ? "var(--color-ink-faint)" : stroke}
        fill={fill}
        strokeWidth={isZero ? 1.2 : 1.8}
        opacity={isZero ? 0.6 : 1}
        seed={seedBase}
      />
      <div className={styles.cellInner}>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value === 0 ? "" : String(value)}
          placeholder="·"
          disabled={disabled}
          onChange={(e) => onChange(playerId, category, parseInput(e.target.value))}
          data-testid={`score-input-${playerId}-${category}`}
          className={styles.scoreInput}
          aria-label={`${category} score for player`}
        />
      </div>
      {showTreasuryHint && (
        <span
          className={styles.treasuryHint}
          data-testid={`score-treasury-hint-${playerId}`}
        >
          {t("scoring.sevenWondersDuel.treasuryHint", {
            coins: value,
            vp: treasuryVp,
          })}
        </span>
      )}
    </div>
  );
}

function TotalCell({
  playerId,
  total,
  tilt,
  isWinner,
  seedBase,
}: {
  playerId: string;
  total: number;
  tilt: number;
  isWinner: boolean;
  seedBase: number;
}) {
  return (
    <div
      className={styles.totalCell}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <SketchRect
        width={150}
        height={46}
        stroke={isWinner ? "var(--color-accent)" : "var(--color-ink)"}
        fill={
          isWinner
            ? "color-mix(in srgb, var(--color-accent) 14%, var(--color-surface))"
            : "var(--color-surface)"
        }
        strokeWidth={isWinner ? 2.8 : 2}
        seed={seedBase}
      />
      <span
        className={`${styles.totalNumber} ${isWinner ? styles.totalNumberWinner : ""}`}
        data-testid={`score-grid-total-${playerId}`}
      >
        {total}
      </span>
      {isWinner && <span className={styles.winnerStar}>★</span>}
    </div>
  );
}

type SupremacyRowProps = {
  type: SupremacyType;
  glyphId: "military-sup" | "scientific-sup";
  accent: string;
  players: ScoreGridPlayer[];
  supremacy: SupremacySelection;
  onToggle: (type: SupremacyType, playerId: string) => void;
  disabled?: boolean;
  template: string;
};

function SupremacyRow({
  type,
  glyphId,
  accent,
  players,
  supremacy,
  onToggle,
  disabled,
  template,
}: SupremacyRowProps) {
  return (
    <div
      className={styles.row}
      style={
        {
          gridTemplateColumns: template,
          ["--cat-strong" as string]: accent,
        } as CSSProperties
      }
    >
      <div className={styles.iconCell}>
        <CatGlyph id={glyphId} size={28} color={accent} />
      </div>
      {players.map((p) => {
        const checked = supremacy?.type === type && supremacy.playerId === p.id;
        return (
          <div key={p.id} className={styles.supremacyCheckboxCell}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onToggle(type, p.id)}
              data-testid={`supremacy-${type}-${p.id}`}
              className={styles.supremacyCheckbox}
              aria-label={`${type} for ${p.name}`}
            />
          </div>
        );
      })}
    </div>
  );
}
