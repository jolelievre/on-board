type Props = {
  /** Slug-keyed visual variant. Falls back to a generic gradient. */
  slug: string;
  /** Logo "stage" width — the SVG glyph is composed inside a viewBox
   * of this width. When `fluid` is false, this is also the rendered
   * container width (legacy tile use case). */
  width?: number;
  /** Container height. */
  height?: number;
  /** When true, the container fills its parent's width and the logo
   * stays centred horizontally — the gradient background expands to
   * fill the available space on wider viewports (desktop / tablet).
   * Defaults to false to preserve the games-index tile layout, where
   * a fixed `width` slots into a flex row beside the card body. */
  fluid?: boolean;
};

/**
 * Decorative cover art for a game tile / detail header. Pure SVG,
 * theme-aware via CSS variables. The art is composed of three layers:
 *
 *   1. Gradient background on the outer container (stretches when
 *      `fluid`).
 *   2. Optional decoration layer that spans the FULL container width
 *      (e.g. 7WD's horizon line) — without this, the line would
 *      stop at the inner SVG's edge on wide viewports.
 *   3. A centred SVG "logo stage" — fixed `width`×96 regardless of
 *      container — so the glyph stays crisp at its intrinsic size
 *      and doesn't distort. The 96 is the intrinsic logo height the
 *      art was designed for; the container `height` can grow taller
 *      and we just centre vertically.
 *
 * Add a new branch when introducing a new game.
 */
export function CoverArt({
  slug,
  width = 92,
  height = 96,
  fluid = false,
}: Props) {
  if (slug === "7-wonders-duel") {
    return <SevenWondersCover width={width} height={height} fluid={fluid} />;
  }
  if (slug === "skull-king") {
    return <SkullKingCover width={width} height={height} fluid={fluid} />;
  }
  return <GenericCover width={width} height={height} fluid={fluid} />;
}

type VariantProps = { width: number; height: number; fluid: boolean };

/** Intrinsic logo stage height — the y-coordinate space the original
 * SVG paths were drawn against. Both game variants share it so the
 * gradient containers can mix freely on wider container heights. */
const STAGE_HEIGHT = 96;

function SevenWondersCover({ width, height, fluid }: VariantProps) {
  const cx = width / 2;
  // Logo stage is centred vertically in the container. The original
  // glyph was drawn against a 96-unit stage where the pyramid base
  // sits at y=80 — that's 32 below the stage's vertical midpoint
  // (48). On any container height, the horizon line therefore lives
  // at "container centre + 32px" so it stays glued to the pyramid
  // base whether the container is 96 or 200 tall.
  const horizonOffsetFromCentre = 80 - STAGE_HEIGHT / 2;
  return (
    <div
      style={{
        width: fluid ? "100%" : width,
        minHeight: height,
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(160deg, var(--color-cat-commercial-bg), var(--color-cat-guilds-bg))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-hidden
    >
      {/* Horizon line — full container width, sits at the same Y as
       * the bottom edge of the logo's pyramid (the stage's y=80). */}
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `calc(50% + ${horizonOffsetFromCentre}px)`,
          height: 1,
          background: "var(--color-ink)",
          opacity: 0.4,
          pointerEvents: "none",
        }}
      />
      <svg
        width={width}
        height={STAGE_HEIGHT}
        viewBox={`0 0 ${width} ${STAGE_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ flexShrink: 0, position: "relative" }}
      >
        <circle
          cx={width - 18}
          cy={18}
          r={10}
          fill="var(--color-cat-commercial-strong)"
          opacity={0.8}
        />
        <path
          d={`M${cx - 26} 80 L${cx} 28 L${cx + 26} 80 Z`}
          fill="var(--color-ink)"
          opacity={0.78}
        />
        <path
          d={`M${cx - 15} 58 L${cx + 15} 58 L${cx + 19} 64 L${cx - 19} 64 Z`}
          fill="var(--color-cat-civil-strong)"
          opacity={0.9}
        />
        <path
          d={`M${cx - 22} 70 L${cx + 22} 70 L${cx + 26} 80 L${cx - 26} 80 Z`}
          fill="var(--color-cat-military-strong)"
          opacity={0.5}
        />
        <circle cx={cx} cy={28} r={1.6} fill="var(--color-bg)" />
      </svg>
    </div>
  );
}

function SkullKingCover({ width, height, fluid }: VariantProps) {
  const cx = width / 2;
  // Skull centred vertically — the original drawing sat slightly
  // above the stage centre; shifting everything down by +6 puts the
  // glyph's vertical midpoint on the stage midpoint.
  const sy = 6;
  return (
    <div
      style={{
        width: fluid ? "100%" : width,
        minHeight: height,
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(160deg, var(--color-cat-civil-bg), var(--color-cat-guilds-bg))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-hidden
    >
      <svg
        width={width}
        height={STAGE_HEIGHT}
        viewBox={`0 0 ${width} ${STAGE_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ flexShrink: 0, position: "relative" }}
      >
        {/* Crossbones (drawn first so they sit BEHIND the skull).
         * Each bone = a fat round-capped line + two knob discs at
         * each end. Two `<g>` groups rotate ±45° around the skull's
         * centre to form an X. Hardcoded warm khaki (`#c9b78a`) reads
         * as "browner ivory" against both the Parchment pastel and
         * Candlelit dark gradients. Solid colour, no opacity, so the
         * two crossed bones don't darken at the intersection. */}
        <g transform={`translate(${cx} ${42 + sy}) rotate(45)`}>
          <line
            x1={-30}
            y1={0}
            x2={30}
            y2={0}
            stroke="#c9b78a"
            strokeWidth={5}
            strokeLinecap="round"
          />
          <circle cx={-30} cy={-3.5} r={4} fill="#c9b78a" />
          <circle cx={-30} cy={3.5} r={4} fill="#c9b78a" />
          <circle cx={30} cy={-3.5} r={4} fill="#c9b78a" />
          <circle cx={30} cy={3.5} r={4} fill="#c9b78a" />
        </g>
        <g transform={`translate(${cx} ${42 + sy}) rotate(-45)`}>
          <line
            x1={-30}
            y1={0}
            x2={30}
            y2={0}
            stroke="#c9b78a"
            strokeWidth={5}
            strokeLinecap="round"
          />
          <circle cx={-30} cy={-3.5} r={4} fill="#c9b78a" />
          <circle cx={-30} cy={3.5} r={4} fill="#c9b78a" />
          <circle cx={30} cy={-3.5} r={4} fill="#c9b78a" />
          <circle cx={30} cy={3.5} r={4} fill="#c9b78a" />
        </g>

        {/* Crown — three triangular points above the skull. */}
        <path
          d={`M${cx - 15} ${24 + sy} L${cx - 10} ${14 + sy} L${cx - 5} ${22 + sy} L${cx} ${12 + sy} L${cx + 5} ${22 + sy} L${cx + 10} ${14 + sy} L${cx + 15} ${24 + sy} Z`}
          fill="var(--color-cat-commercial-strong)"
        />

        {/* Skull cranium + jaw + features. Solid `--color-ink-soft`
         * (no opacity) so the cranium and jaw don't double-darken
         * where they overlap. The soft ink reads as a flat skull
         * grey in light mode and stays light-but-readable in dark
         * mode, both with the same blended weight the previous
         * `ink @ 0.78` produced. */}
        <ellipse
          cx={cx}
          cy={42 + sy}
          rx={20}
          ry={19}
          fill="var(--color-ink-soft)"
        />
        <rect
          x={cx - 12}
          y={56 + sy}
          width={24}
          height={14}
          rx={3}
          fill="var(--color-ink-soft)"
        />
        <circle cx={cx - 7} cy={42 + sy} r={3.5} fill="var(--color-bg)" />
        <circle cx={cx + 7} cy={42 + sy} r={3.5} fill="var(--color-bg)" />
        <line
          x1={cx - 7}
          y1={62 + sy}
          x2={cx - 7}
          y2={70 + sy}
          stroke="var(--color-bg)"
          strokeWidth={1.4}
        />
        <line
          x1={cx}
          y1={62 + sy}
          x2={cx}
          y2={70 + sy}
          stroke="var(--color-bg)"
          strokeWidth={1.4}
        />
        <line
          x1={cx + 7}
          y1={62 + sy}
          x2={cx + 7}
          y2={70 + sy}
          stroke="var(--color-bg)"
          strokeWidth={1.4}
        />
      </svg>
    </div>
  );
}

function GenericCover({ width, height, fluid }: VariantProps) {
  return (
    <div
      style={{
        width: fluid ? "100%" : width,
        minHeight: height,
        background:
          "linear-gradient(160deg, var(--color-cat-civil-bg), var(--color-cat-progress-bg))",
      }}
      aria-hidden
    />
  );
}
