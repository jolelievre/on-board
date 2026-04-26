import { useTranslation } from "react-i18next";
import {
  SEVEN_WONDERS_CATEGORIES,
  categoryToVictoryPoints,
  computePlayerTotal,
  type SevenWondersCategoryKey,
} from "../../../shared/scoring/7-wonders-duel";

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

const MILITARY_COLOR = "#dc2626";
const SCIENTIFIC_COLOR = "#16a34a";

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
};

function parseInput(raw: string): number {
  if (raw === "" || raw === "-") return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : n;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function SevenWondersScoreGrid({
  players,
  values,
  onChange,
  supremacy,
  onSupremacyChange,
  disabled,
}: Props) {
  const { t } = useTranslation();

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
    <div
      className="grid gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200"
      style={{
        gridTemplateColumns: `minmax(7rem, 1fr) repeat(${players.length}, minmax(4rem, 1fr))`,
      }}
      data-testid="score-grid"
    >
      {/* Header row */}
      <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500" />
      {players.map((p) => (
        <div
          key={p.id}
          className="bg-gray-50 px-2 py-2 text-center text-sm font-semibold text-gray-800"
          data-testid={`score-grid-player-${p.id}`}
        >
          {p.name}
        </div>
      ))}

      {/* Category rows */}
      {SEVEN_WONDERS_CATEGORIES.map((cat) => (
        <CategoryRow
          key={cat.key}
          category={cat.key}
          color={cat.color}
          min={cat.min}
          max={cat.max}
          label={t(`scoring.sevenWondersDuel.categories.${cat.key}`)}
          players={players}
          values={values}
          onChange={onChange}
          disabled={disabled}
        />
      ))}

      {/* Totals row */}
      <div className="bg-gray-100 px-3 py-3 text-sm font-bold uppercase tracking-wide text-gray-700">
        {t("scoring.sevenWondersDuel.total")}
      </div>
      {totals.map(({ player, total }) => (
        <div
          key={player.id}
          className="bg-gray-100 px-2 py-3 text-center text-lg font-bold text-gray-900"
          data-testid={`score-grid-total-${player.id}`}
        >
          {total}
        </div>
      ))}

      {/* Supremacy rows */}
      <SupremacyRow
        type="military_supremacy"
        color={MILITARY_COLOR}
        label={t("scoring.sevenWondersDuel.specialVictory.military")}
        players={players}
        supremacy={supremacy}
        onToggle={toggleSupremacy}
        disabled={disabled}
      />
      <SupremacyRow
        type="scientific_supremacy"
        color={SCIENTIFIC_COLOR}
        label={t("scoring.sevenWondersDuel.specialVictory.scientific")}
        players={players}
        supremacy={supremacy}
        onToggle={toggleSupremacy}
        disabled={disabled}
      />
    </div>
  );
}

type CategoryRowProps = {
  category: SevenWondersCategoryKey;
  color: string;
  min?: number;
  max?: number;
  label: string;
  players: ScoreGridPlayer[];
  values: ScoreGridValues;
  onChange: Props["onChange"];
  disabled?: boolean;
};

function CategoryRow({
  category,
  color,
  min,
  max,
  label,
  players,
  values,
  onChange,
  disabled,
}: CategoryRowProps) {
  const { t } = useTranslation();
  const rowBg = hexToRgba(color, 0.12);

  return (
    <>
      <div
        className="flex items-center px-3 py-2"
        style={{ backgroundColor: rowBg, borderLeft: `4px solid ${color}` }}
      >
        <span className="text-sm font-medium text-gray-900">{label}</span>
      </div>
      {players.map((p) => {
        const raw = values[p.id]?.[category] ?? 0;
        const vp = categoryToVictoryPoints(category, raw);
        return (
          <div
            key={p.id}
            className="flex flex-col items-center justify-center px-2 py-2"
            style={{ backgroundColor: rowBg }}
          >
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={raw === 0 ? "" : String(raw)}
              placeholder="0"
              disabled={disabled}
              min={min}
              max={max}
              onChange={(e) => onChange(p.id, category, parseInput(e.target.value))}
              data-testid={`score-input-${p.id}-${category}`}
              className="w-full max-w-[4rem] rounded border border-gray-300 bg-white px-2 py-1 text-center text-base text-gray-900 focus:border-blue-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
            {category === "treasury" && raw > 0 && (
              <span
                className="mt-1 text-[10px] text-gray-700"
                data-testid={`score-treasury-hint-${p.id}`}
              >
                {t("scoring.sevenWondersDuel.treasuryHint", {
                  coins: raw,
                  vp,
                })}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

type SupremacyRowProps = {
  type: SupremacyType;
  color: string;
  label: string;
  players: ScoreGridPlayer[];
  supremacy: SupremacySelection;
  onToggle: (type: SupremacyType, playerId: string) => void;
  disabled?: boolean;
};

function SupremacyRow({
  type,
  color,
  label,
  players,
  supremacy,
  onToggle,
  disabled,
}: SupremacyRowProps) {
  const rowBg = hexToRgba(color, 0.18);

  return (
    <>
      <div
        className="flex items-center px-3 py-2"
        style={{ backgroundColor: rowBg, borderLeft: `4px solid ${color}` }}
      >
        <span className="text-sm font-semibold text-gray-900">{label}</span>
      </div>
      {players.map((p) => {
        const checked = supremacy?.type === type && supremacy.playerId === p.id;
        return (
          <div
            key={p.id}
            className="flex items-center justify-center px-2 py-2"
            style={{ backgroundColor: rowBg }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onToggle(type, p.id)}
              data-testid={`supremacy-${type}-${p.id}`}
              className="h-5 w-5 cursor-pointer accent-current"
              style={{ color }}
            />
          </div>
        );
      })}
    </>
  );
}
