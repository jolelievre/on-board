/**
 * Skull King-themed inline SVG glyphs. Theme-aware via `var(--sk-*)` tokens
 * so they read correctly on both Parchment and Candlelit.
 */

type GlyphProps = {
  size?: number;
  className?: string;
};

export function SkullGlyph({
  size = 36,
  crown = true,
  crownColor = "var(--sk-gold)",
  color = "currentColor",
  className,
}: GlyphProps & {
  crown?: boolean;
  crownColor?: string;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
      className={className}
    >
      {crown && (
        <path
          d="M10 12 L14 6 L18 11 L24 5 L30 11 L34 6 L38 12 L34 16 L14 16 Z"
          fill={crownColor}
        />
      )}
      <path
        d="M12 18 Q12 30 16 35 L16 40 L20 40 L20 36 L28 36 L28 40 L32 40 L32 35 Q36 30 36 18 Q36 12 24 12 Q12 12 12 18 Z"
        fill={color}
      />
      <circle cx="19" cy="24" r="3.2" fill="var(--color-bg)" />
      <circle cx="29" cy="24" r="3.2" fill="var(--color-bg)" />
      <rect x="20" y="33" width="2" height="3.5" fill="var(--color-bg)" />
      <rect x="23" y="33" width="2" height="3.5" fill="var(--color-bg)" />
      <rect x="26" y="33" width="2" height="3.5" fill="var(--color-bg)" />
    </svg>
  );
}

export function CardChip({
  size = 36,
  color,
  ink,
  label = "14",
  className,
}: GlyphProps & { color: string; ink: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size * 1.32}
      viewBox="0 0 30 40"
      aria-hidden
      className={className}
    >
      <rect
        x="2"
        y="2"
        width="26"
        height="36"
        rx="3.5"
        fill={color}
        stroke={ink}
        strokeWidth="1.5"
      />
      <text
        x="15"
        y="25"
        textAnchor="middle"
        fontFamily="Caveat, cursive"
        fontWeight="700"
        fontSize="16"
        fill={ink}
      >
        {label}
      </text>
    </svg>
  );
}

export function BlackFlag({ size = 36, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size * 1.32}
      viewBox="0 0 30 40"
      aria-hidden
      className={className}
    >
      <rect
        x="2"
        y="2"
        width="26"
        height="36"
        rx="3.5"
        fill="var(--sk-black-bg)"
        stroke="var(--sk-black)"
        strokeWidth="1.5"
      />
      <text
        x="15"
        y="14"
        textAnchor="middle"
        fontFamily="Caveat, cursive"
        fontWeight="700"
        fontSize="11"
        fill="var(--sk-black)"
      >
        14
      </text>
      <line
        x1="14"
        y1="18"
        x2="14"
        y2="33"
        stroke="var(--sk-black)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M14 18 L24 20 L21 23 L24 26 L14 24 Z" fill="var(--sk-black)" />
    </svg>
  );
}

export function PirateGlyph({
  size = 32,
  color = "var(--sk-blood)",
  className,
}: GlyphProps & { color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden
      className={className}
    >
      <path
        d="M8 14 Q10 6 20 6 Q30 6 32 14 L34 14 L36 12 L34 18 L6 18 L4 12 L6 14 Z"
        fill={color}
      />
      <circle
        cx="20"
        cy="22"
        r="10"
        fill="var(--sk-bone)"
        stroke="var(--color-ink)"
        strokeWidth="1.2"
      />
      <path d="M10 19 L18 21 L18 24 L10 22 Z" fill="var(--color-ink)" />
      <circle cx="24" cy="22" r="1.3" fill="var(--color-ink)" />
      <path
        d="M16 28 Q20 31 24 28"
        stroke="var(--color-ink)"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MermaidGlyph({ size = 32, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden
      className={className}
    >
      <path
        d="M11 12 Q12 6 20 6 Q28 6 29 12 L29 18 Q26 14 20 14 Q14 14 11 18 Z"
        fill="var(--sk-blood)"
      />
      <circle
        cx="20"
        cy="16"
        r="6"
        fill="var(--sk-bone)"
        stroke="var(--color-ink)"
        strokeWidth="1"
      />
      <path
        d="M14 22 Q14 30 20 32 Q26 30 26 22 Q23 24 20 24 Q17 24 14 22 Z"
        fill="var(--sk-sea)"
      />
      <path
        d="M14 32 Q20 36 26 32 L26 35 L20 32 L14 35 Z"
        fill="var(--sk-sea-deep)"
      />
      <path
        d="M16 25 Q20 27 24 25 M16 28 Q20 30 24 28"
        stroke="var(--color-ink)"
        strokeWidth="0.7"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}

export function TrophyGlyph({
  size = 28,
  color = "var(--sk-gold)",
  className,
}: GlyphProps & { color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden
      className={className}
    >
      <path
        d="M12 6 L28 6 L28 14 Q28 22 20 22 Q12 22 12 14 Z"
        fill={color}
        stroke="var(--color-ink)"
        strokeWidth="1"
      />
      <path
        d="M12 8 Q6 8 6 14 Q6 18 10 18"
        stroke="var(--color-ink)"
        strokeWidth="1.2"
        fill="none"
      />
      <path
        d="M28 8 Q34 8 34 14 Q34 18 30 18"
        stroke="var(--color-ink)"
        strokeWidth="1.2"
        fill="none"
      />
      <rect
        x="16"
        y="22"
        width="8"
        height="6"
        fill={color}
        stroke="var(--color-ink)"
        strokeWidth="1"
      />
      <rect
        x="11"
        y="28"
        width="18"
        height="4"
        rx="1"
        fill={color}
        stroke="var(--color-ink)"
        strokeWidth="1"
      />
    </svg>
  );
}

export function ColorCardChip({
  variant,
  size = 24,
}: {
  variant: "yellow" | "green" | "purple";
  size?: number;
}) {
  const map = {
    yellow: ["var(--sk-yellow-bg)", "var(--sk-yellow)"],
    green: ["var(--sk-green-bg)", "var(--sk-green)"],
    purple: ["var(--sk-purple-bg)", "var(--sk-purple)"],
  } as const;
  const [bg, ink] = map[variant];
  return <CardChip size={size} color={bg} ink={ink} />;
}
