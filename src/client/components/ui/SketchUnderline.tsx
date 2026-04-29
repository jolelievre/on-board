import { jp } from "./sketch";

type Props = {
  width: number;
  color: string;
  seed?: number;
  strokeWidth?: number;
  double?: boolean;
};

export function SketchUnderline({
  width,
  color,
  seed = 1,
  strokeWidth = 2,
  double = false,
}: Props) {
  const j = (s: number) => jp(seed + s, 1.5);
  const steps = Math.max(4, Math.floor(width / 14));
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(`${(i / steps) * width},${j(i) * 0.8}`);
  }
  const d = "M " + points.join(" L ");

  return (
    <svg
      width={width}
      height={10}
      viewBox={`0 -5 ${width} 10`}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {double && (
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth * 0.4}
          strokeLinecap="round"
          transform="translate(2, 2)"
          opacity={0.5}
        />
      )}
    </svg>
  );
}
