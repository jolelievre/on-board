import { Icon } from "./Icon";
import styles from "./WinnerBadge.module.css";

type Props = {
  /** Pixel size of the disc. Defaults to 22px to match the design
   * handoff's standard avatar-overlay scale. */
  size?: number;
  /** Set when the badge is rendered as a top-right overlay on an avatar.
   * Adds absolute positioning so the parent just needs `position:
   * relative`; the badge anchors itself. Defaults to false (inline). */
  overlay?: boolean;
  className?: string;
  /** Accessible label. The badge is decorative by default; pass a label
   * (e.g. "Winner") to expose it to screen readers. */
  title?: string;
};

/**
 * Phase 7 — winner crown badge. A filled gold disc (`--color-crown-gold`)
 * with a dark crown glyph (`--color-crown-gold-ink`), used wherever a
 * winner or current leader is shown: match history rows, the winner
 * banner, the 7 Wonders Duel scorer header, the Skull King round-
 * transition / complete / scoreboard screens.
 *
 * Pass `overlay` to anchor it to the top-right of a parent that has
 * `position: relative` (the typical use over an `<Avatar>`).
 */
export function WinnerBadge({
  size = 22,
  overlay = false,
  className,
  title,
}: Props) {
  const classes = [styles.root, overlay ? styles.overlay : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={classes}
      style={{ width: size, height: size }}
      // Decorative unless an explicit label is given — the surrounding
      // text usually already announces "X wins" / "Leader".
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <Icon name="crown" size={size * 0.6} />
    </span>
  );
}
