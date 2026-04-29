import type { ReactNode } from "react";
import styles from "./PillSwitch.module.css";

type Option<V extends string> = {
  value: V;
  label: ReactNode;
};

type Props<V extends string> = {
  value: V;
  options: readonly Option<V>[];
  onChange: (value: V) => void;
  ariaLabel?: string;
  className?: string;
};

/**
 * Segmented pill control. Used by language and theme switches.
 * Behaves like a single-select radio group.
 */
export function PillSwitch<V extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: Props<V>) {
  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
