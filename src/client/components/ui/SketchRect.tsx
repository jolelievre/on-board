import { jp } from "./sketch";

type Props = {
  width: number;
  height: number;
  stroke: string;
  fill?: string;
  strokeWidth?: number;
  seed?: number;
  radius?: number;
  opacity?: number;
};

/**
 * Hand-drawn rounded rectangle.
 *
 * Builds a wobbly bezier path for each side; renders the path twice for a
 * "scribble" double-stroke. Per-cell wobble is deterministic from `seed`.
 *
 * Position: absolute, top/left -2 (so the wobble that overshoots the bbox
 * stays visible). Place inside a relatively-positioned wrapper.
 */
export function SketchRect({
  width,
  height,
  stroke,
  fill = "none",
  strokeWidth = 1.6,
  seed = 1,
  radius = 6,
  opacity = 1,
}: Props) {
  const w = width;
  const h = height;
  const r = radius;
  const j = (s: number) => jp(seed + s, 1.2);

  const buildPath = (off: number) => {
    const o = off;
    return `
      M ${r + j(1 + o)} ${j(2 + o) * 0.3}
      L ${w - r + j(3 + o)} ${j(4 + o) * 0.3}
      Q ${w + j(5 + o) * 0.5} ${j(6 + o) * 0.3} ${w + j(7 + o) * 0.3} ${r + j(8 + o) * 0.5}
      L ${w + j(9 + o) * 0.3} ${h - r + j(10 + o)}
      Q ${w + j(11 + o) * 0.3} ${h + j(12 + o) * 0.5} ${w - r + j(13 + o)} ${h + j(14 + o) * 0.3}
      L ${r + j(15 + o)} ${h + j(16 + o) * 0.3}
      Q ${j(17 + o) * 0.5} ${h + j(18 + o) * 0.3} ${j(19 + o) * 0.3} ${h - r + j(20 + o)}
      L ${j(21 + o) * 0.3} ${r + j(22 + o)}
      Q ${j(23 + o) * 0.3} ${j(24 + o) * 0.3} ${r + j(25 + o)} ${j(26 + o) * 0.3}
      Z
    `;
  };

  return (
    <svg
      width={width + 4}
      height={height + 4}
      viewBox={`-2 -2 ${width + 4} ${height + 4}`}
      style={{
        position: "absolute",
        top: -2,
        left: -2,
        pointerEvents: "none",
        opacity,
      }}
      aria-hidden
    >
      {fill !== "none" && <path d={buildPath(0)} fill={fill} stroke="none" />}
      <path
        d={buildPath(0)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={buildPath(100)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth * 0.55}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.55}
      />
    </svg>
  );
}
