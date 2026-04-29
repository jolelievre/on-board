type Props = {
  /** Slug-keyed visual variant. Falls back to a generic gradient. */
  slug: string;
  width?: number;
  height?: number;
};

/**
 * Decorative cover art for a game tile. Pure SVG, theme-aware via CSS vars.
 * Add a new branch when introducing a new game.
 */
export function CoverArt({ slug, width = 92, height = 96 }: Props) {
  if (slug === "7-wonders-duel") {
    return <SevenWondersCover width={width} height={height} />;
  }
  if (slug === "skull-king") {
    return <SkullKingCover width={width} height={height} />;
  }
  return <GenericCover width={width} height={height} />;
}

function SevenWondersCover({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width,
        minHeight: height,
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(160deg, var(--color-cat-commercial-bg), var(--color-cat-guilds-bg))",
      }}
      aria-hidden
    >
      <svg
        width={width}
        height="100%"
        viewBox={`0 0 ${width} 96`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0 }}
      >
        <circle
          cx={width - 18}
          cy={18}
          r={10}
          fill="var(--color-cat-commercial-strong)"
          opacity={0.8}
        />
        <path
          d={`M${width / 2 - 26} 80 L${width / 2} 28 L${width / 2 + 26} 80 Z`}
          fill="var(--color-ink)"
          opacity={0.78}
        />
        <path
          d={`M${width / 2 - 15} 58 L${width / 2 + 15} 58 L${width / 2 + 19} 64 L${width / 2 - 19} 64 Z`}
          fill="var(--color-cat-civil-strong)"
          opacity={0.9}
        />
        <path
          d={`M${width / 2 - 22} 70 L${width / 2 + 22} 70 L${width / 2 + 26} 80 L${width / 2 - 26} 80 Z`}
          fill="var(--color-cat-military-strong)"
          opacity={0.5}
        />
        <line
          x1="0"
          y1="80"
          x2={width}
          y2="80"
          stroke="var(--color-ink)"
          strokeWidth="0.6"
          opacity={0.4}
        />
        <circle cx={width / 2} cy={28} r={1.6} fill="var(--color-bg)" />
      </svg>
    </div>
  );
}

function SkullKingCover({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width,
        minHeight: height,
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(160deg, var(--color-cat-civil-bg), var(--color-cat-guilds-bg))",
      }}
      aria-hidden
    >
      <svg
        width={width}
        height="100%"
        viewBox={`0 0 ${width} 96`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0 }}
      >
        <ellipse
          cx={width / 2}
          cy={42}
          rx={20}
          ry={19}
          fill="var(--color-ink)"
          opacity={0.78}
        />
        <rect
          x={width / 2 - 12}
          y={56}
          width={24}
          height={14}
          rx={3}
          fill="var(--color-ink)"
          opacity={0.78}
        />
        <circle cx={width / 2 - 7} cy={42} r={3.5} fill="var(--color-bg)" />
        <circle cx={width / 2 + 7} cy={42} r={3.5} fill="var(--color-bg)" />
        <line
          x1={width / 2 - 7}
          y1={62}
          x2={width / 2 - 7}
          y2={70}
          stroke="var(--color-bg)"
          strokeWidth="1.4"
        />
        <line
          x1={width / 2}
          y1={62}
          x2={width / 2}
          y2={70}
          stroke="var(--color-bg)"
          strokeWidth="1.4"
        />
        <line
          x1={width / 2 + 7}
          y1={62}
          x2={width / 2 + 7}
          y2={70}
          stroke="var(--color-bg)"
          strokeWidth="1.4"
        />
        <path
          d={`M${width / 2 - 15} 24 L${width / 2 - 10} 14 L${width / 2 - 5} 22 L${width / 2} 12 L${width / 2 + 5} 22 L${width / 2 + 10} 14 L${width / 2 + 15} 24 Z`}
          fill="var(--color-cat-commercial-strong)"
        />
      </svg>
    </div>
  );
}

function GenericCover({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width,
        minHeight: height,
        background:
          "linear-gradient(160deg, var(--color-cat-civil-bg), var(--color-cat-progress-bg))",
      }}
      aria-hidden
    />
  );
}
