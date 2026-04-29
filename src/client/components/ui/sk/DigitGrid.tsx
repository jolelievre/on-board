import styles from "./DigitGrid.module.css";

type Props = {
  /** Maximum digit (inclusive). Cells render 0..max. */
  max: number;
  /** Currently selected value, or undefined. */
  selected: number | undefined;
  /** Callback when a digit is tapped. */
  onPick: (n: number) => void;
  /** Disable interaction. */
  disabled?: boolean;
  /** When true, cells render at the larger size used in the bid bottom sheet. */
  big?: boolean;
  /** Optional test id used by E2E tests to scope queries. */
  "data-testid"?: string;
};

/**
 * A 0..max digit picker. Layout rule: 1 row when there are ≤5 cells (rounds
 * 1–4), 2 rows when there are ≥6 cells (rounds 5–10). Capped at 6 columns.
 */
export function DigitGrid({
  max,
  selected,
  onPick,
  disabled,
  big,
  "data-testid": testId,
}: Props) {
  const cellCount = max + 1;
  const cols = cellCount <= 5 ? cellCount : Math.min(6, Math.ceil(cellCount / 2));

  const digits: number[] = [];
  for (let i = 0; i <= max; i++) digits.push(i);

  return (
    <div
      className={`${styles.grid} ${big ? styles.big : ""}`}
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      data-testid={testId}
    >
      {digits.map((n) => {
        const isSelected = n === selected;
        return (
          <button
            key={n}
            type="button"
            className={`${styles.cell} ${isSelected ? styles.selected : ""}`}
            onClick={() => onPick(n)}
            disabled={disabled}
            data-value={n}
            data-selected={isSelected ? "true" : undefined}
            aria-pressed={isSelected}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
