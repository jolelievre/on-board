import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";
import { SketchRect } from "./SketchRect";
import { jp } from "./sketch";
import styles from "./SketchCheckbox.module.css";

type Props = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "type" | "value"
> & {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Stable seed so the wobble doesn't twitch on every re-render. */
  seed?: number;
  /** Pass-through accent color via CSS variable; defaults to --color-primary. */
  accent?: string;
};

/**
 * A hand-drawn checkbox that matches the SketchRect aesthetic.
 *
 * - Renders a wobbly square outline (SketchRect)
 * - When checked, fills the rect with a tinted color and overlays a
 *   sketchy ✓ tick built from two jittered SVG paths
 * - role="checkbox" + aria-checked so assistive tech still treats it
 *   as a real checkbox
 */
export const SketchCheckbox = forwardRef<HTMLButtonElement, Props>(
  function SketchCheckbox(
    { checked, onChange, seed = 1, accent, className, disabled, ...rest },
    ref,
  ) {
    const stroke = "var(--cat-strong, var(--color-primary))";
    const tickStroke = "var(--cat-strong, var(--color-primary))";

    const style: CSSProperties = accent
      ? ({ ["--cat-strong" as string]: accent } as CSSProperties)
      : {};

    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[styles.box, checked && styles.checked, className]
          .filter(Boolean)
          .join(" ")}
        style={style}
        {...rest}
      >
        <SketchRect
          width={28}
          height={28}
          stroke={stroke}
          fill={
            checked
              ? "color-mix(in srgb, var(--cat-strong, var(--color-primary)) 14%, transparent)"
              : "transparent"
          }
          strokeWidth={checked ? 2.2 : 1.6}
          seed={seed}
          radius={5}
        />
        {checked && <SketchTick seed={seed + 9} stroke={tickStroke} />}
      </button>
    );
  },
);

function SketchTick({ seed, stroke }: { seed: number; stroke: string }) {
  // Two-segment ✓: starts inside-left, dips down-and-right to the elbow,
  // then climbs up-and-right to the tip. Each endpoint gets a tiny jitter
  // so the tick feels hand-drawn but stays anchored to the box.
  const j = (s: number) => jp(seed + s, 1.1);
  const x1 = 8 + j(1);
  const y1 = 16 + j(2);
  const x2 = 13.5 + j(3);
  const y2 = 21 + j(4);
  const x3 = 22 + j(5);
  const y3 = 10 + j(6);
  const path = `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3}`;
  return (
    <svg
      className={styles.tick}
      width="32"
      height="32"
      viewBox="0 0 32 32"
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinecap="round"
        opacity={0.55}
        transform="translate(0.6, -0.6)"
      />
    </svg>
  );
}
