import styles from "./VsMark.module.css";

type Props = {
  /** Pixel size of the dashed ring. Defaults to 32px to match the
   * 2-player match-row mock. */
  size?: number;
  className?: string;
};

/**
 * Phase 7 — "VS" mark for 2-player match rows. A hand-drawn-looking
 * dashed ring with Caveat "VS" lettering inside, slightly rotated for
 * the notebook feel. Lives as a dedicated component (rather than a
 * single `Icon` entry) because the lettering is typographic and the
 * dashed ring uses the project's `--color-border-strong` token.
 */
export function VsMark({ size = 32, className }: Props) {
  const classes = [styles.root, className].filter(Boolean).join(" ");
  return (
    <span
      className={classes}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className={styles.ring} aria-hidden="true" />
      <span
        className={styles.label}
        style={{ fontSize: `${size * 0.5}px` }}
      >
        VS
      </span>
    </span>
  );
}
