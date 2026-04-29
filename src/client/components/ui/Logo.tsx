import { useEffect, useState, type CSSProperties } from "react";
import styles from "./Logo.module.css";

type Phase = "pre" | "jump" | "land" | "rest";

type Props = {
  size?: number;
  /** "tilted" trapezoid board or "hex" tile. Hex is the locked design choice. */
  board?: "tilted" | "hex";
  /** Hide the "OnBoard" wordmark; render the glyph alone. */
  glyphOnly?: boolean;
  /** Play the pawn-jump intro once (or loop with `loop`). */
  animate?: boolean;
  /** Loop the intro animation (use on splash). */
  loop?: boolean;
  /** Force a single color instead of the two-tone (ink + primary + accent). */
  mono?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * OnBoard logo — pawn glyph + wordmark.
 *
 * Colors come from CSS variables: `--color-ink` (grid lines), `--color-primary`
 * (pawn + "On"), `--color-accent` (board + "Board"). `prefers-reduced-motion`
 * collapses the animation to a static frame.
 */
export function Logo({
  size = 36,
  board = "hex",
  glyphOnly = false,
  animate = false,
  loop = false,
  mono,
  className,
  style,
}: Props) {
  const ink = mono ?? "var(--color-ink)";
  const accent1 = mono ?? "var(--color-primary)";
  const accent2 = mono ?? "var(--color-accent)";

  const [phase, setPhase] = useState<Phase>(animate ? "pre" : "rest");

  useEffect(() => {
    if (!animate) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPhase("rest");
      return;
    }
    let t1: number, t2: number, t3: number;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      setPhase("pre");
      t1 = window.setTimeout(() => setPhase("jump"), 80);
      t2 = window.setTimeout(() => setPhase("land"), 720);
      t3 = window.setTimeout(() => {
        setPhase("rest");
        if (loop) window.setTimeout(run, 1400);
      }, 1100);
    };
    run();
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [animate, loop]);

  const boardEl =
    board === "tilted" ? (
      <g>
        <ellipse cx="22" cy="32" rx="14" ry="1.4" fill={ink} opacity="0.18" />
        <path d="M8 30 L36 30 L32 22 L12 22 Z" fill={accent2} />
        <path d="M8 30 L8 31.6 L36 31.6 L36 30 Z" fill={accent2} opacity="0.55" />
        <g
          stroke="var(--color-bg)"
          strokeWidth="0.7"
          strokeLinecap="round"
          opacity="0.5"
        >
          <line x1="11.5" y1="26" x2="32.5" y2="26" />
          <line x1="19" y1="22" x2="19" y2="30" />
          <line x1="25" y1="22" x2="25" y2="30" />
        </g>
      </g>
    ) : (
      <g>
        <ellipse cx="22" cy="32" rx="13" ry="1.3" fill={ink} opacity="0.18" />
        <path
          d="M11 28 L16 24 L28 24 L33 28 L28 32 L16 32 Z"
          fill={accent2}
        />
        <g
          stroke="var(--color-bg)"
          strokeWidth="0.6"
          opacity="0.45"
          strokeLinecap="round"
        >
          <line x1="16" y1="24" x2="22" y2="28" />
          <line x1="28" y1="24" x2="22" y2="28" />
          <line x1="33" y1="28" x2="22" y2="28" />
          <line x1="28" y1="32" x2="22" y2="28" />
          <line x1="16" y1="32" x2="22" y2="28" />
          <line x1="11" y1="28" x2="22" y2="28" />
        </g>
      </g>
    );

  const pawnPath = (
    <g>
      <circle cx="22" cy="15.5" r="3.4" fill={accent1} />
      <rect x="19" y="18.5" width="6" height="1.3" rx="0.5" fill={accent1} />
      <path d="M18.6 20 Q22 17.5 25.4 20 L26 28 L18 28 Z" fill={accent1} />
      <rect x="17" y="28" width="10" height="2.2" rx="0.4" fill={accent1} />
    </g>
  );

  let pawnTransform = animate ? "" : "translate(-2px, -16px) rotate(-4deg)";
  if (animate) {
    if (phase === "pre") pawnTransform = "translate(-14px, -6px) rotate(-12deg)";
    else if (phase === "jump") pawnTransform = "translate(-2px, -16px) rotate(-4deg)";
    else if (phase === "land")
      pawnTransform = "translate(0, 0) rotate(0deg) scale(1, 0.97)";
    else pawnTransform = "translate(0, 0) rotate(0deg)";
  }

  const dust = animate && (phase === "land" || phase === "rest") && (
    <g className={styles.dust}>
      <line
        x1="14"
        y1="26"
        x2="11"
        y2="25"
        stroke={accent2}
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <line
        x1="30"
        y1="26"
        x2="33"
        y2="25"
        stroke={accent2}
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <line
        x1="22"
        y1="27"
        x2="22"
        y2="29"
        stroke={accent2}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
    </g>
  );

  const trail = (!animate || phase === "jump") && (
    <path
      d="M2 32 Q14 6 22 14"
      stroke={accent1}
      strokeWidth="1.3"
      strokeDasharray="2 2"
      fill="none"
      strokeLinecap="round"
      opacity="0.55"
    />
  );

  const glyph = (
    <svg
      className={styles.glyph}
      width={(size * 44) / 52}
      height={size}
      viewBox="0 -16 44 52"
      aria-hidden
    >
      {boardEl}
      {trail}
      <g
        style={{
          transform: pawnTransform,
          transition:
            phase === "jump"
              ? "transform 0.6s cubic-bezier(.5,1.6,.5,1)"
              : phase === "land"
                ? "transform 0.18s cubic-bezier(.4,1.8,.6,1)"
                : "transform 0.25s ease-out",
          transformBox: "fill-box",
        }}
      >
        {pawnPath}
      </g>
      {dust}
    </svg>
  );

  if (glyphOnly) {
    return (
      <span className={className} style={style}>
        {glyph}
      </span>
    );
  }

  return (
    <span
      className={`${styles.root}${className ? " " + className : ""}`}
      style={style}
    >
      {glyph}
      <span className={styles.wordmark} style={{ fontSize: size * 0.78 }}>
        <span className={styles.wordmarkOn}>On</span>
        <span className={styles.wordmarkBoard}>Board</span>
      </span>
    </span>
  );
}
