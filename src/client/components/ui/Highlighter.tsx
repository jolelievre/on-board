import styles from "./Highlighter.module.css";

type Props = {
  /** CSS colour for the highlighter swipe. Defaults to the accent token
   * (teal in Parchment, copper in Candlelit) — the "this is me" colour. */
  color?: string;
  className?: string;
};

/**
 * Phase 7 — translucent skewed accent block used behind the player's
 * name in a match-history row to mark "this is me". The colour is
 * deliberately accent-by-default so callers don't need to think about
 * it; pass `color` to override for non-"me" semantic uses.
 *
 * The element is absolutely positioned and `pointer-events: none`, so
 * the parent only needs `position: relative` and the content (name)
 * needs to sit above with its own `position: relative` + z-index.
 */
export function Highlighter({ color, className }: Props) {
  const classes = [styles.root, className].filter(Boolean).join(" ");
  // Inline `background` override lets callers theme to a non-accent
  // colour without forking the component. `color` falls through to the
  // CSS default when omitted.
  return (
    <span
      aria-hidden="true"
      className={classes}
      style={color ? { background: color } : undefined}
    />
  );
}
