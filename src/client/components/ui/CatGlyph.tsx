export type CatGlyphId =
  | "civil"
  | "scientific"
  | "commercial"
  | "guilds"
  | "wonders"
  | "progress"
  | "treasury"
  | "military"
  | "sigma"
  | "military-sup"
  | "scientific-sup";

type Props = {
  id: CatGlyphId;
  size?: number;
  /** Primary color. Defaults to currentColor — set color via parent CSS. */
  color?: string;
  /** Secondary tone (used by composite glyphs like military-sup). */
  accent?: string;
};

/**
 * 7 Wonders Duel category glyphs.
 *
 * Color via `color` prop or via parent CSS `color` (currentColor default).
 * Use the same glyph everywhere a category needs to be identified —
 * never invent or restyle per surface.
 */
export function CatGlyph({
  id,
  size = 22,
  color = "currentColor",
  accent,
}: Props) {
  const c = color;
  const a = accent ?? color;
  const sw = Math.max(1.2, size / 14);
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  } as const;

  switch (id) {
    case "civil":
    case "scientific":
    case "commercial":
    case "guilds":
      return (
        <svg {...props}>
          <rect x="4" y="4" width="16" height="16" rx="1.5" fill={c} />
          <rect x="6" y="6" width="12" height="3" rx="0.6" fill="#fff" opacity="0.18" />
        </svg>
      );
    case "wonders":
      return (
        <svg
          {...props}
          fill="none"
          stroke={c}
          strokeWidth={sw}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M4.5 19 L12 5 L19.5 19 Z" fill={c} fillOpacity="0.08" />
          <line x1="3.5" y1="20" x2="20.5" y2="20" />
        </svg>
      );
    case "progress":
      return (
        <svg {...props}>
          <circle
            cx="12"
            cy="12"
            r="8"
            fill={c}
            fillOpacity="0.12"
            stroke={c}
            strokeWidth={sw}
          />
          <circle cx="12" cy="12" r="4.6" fill="none" stroke={c} strokeWidth={sw} />
          <path
            d="M9 12 a3 5 0 014 -4 M15 12 a-3 5 0 01-4 -4"
            stroke={c}
            strokeWidth={sw * 0.7}
            fill="none"
            strokeLinecap="round"
            opacity="0.7"
          />
        </svg>
      );
    case "treasury":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" fill={c} />
          <circle
            cx="12"
            cy="12"
            r="6"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.45"
            strokeWidth={sw * 0.6}
          />
          <text
            x="12"
            y="16"
            textAnchor="middle"
            fontFamily='"JetBrains Mono", monospace'
            fontWeight="700"
            fontSize="10"
            fill="#fff"
          >
            $
          </text>
        </svg>
      );
    case "military":
      return (
        <svg
          {...props}
          fill="none"
          stroke={c}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M5 4 H19 V12 C19 17 15.5 19.5 12 21 C8.5 19.5 5 17 5 12 Z"
            fill={c}
            fillOpacity="0.08"
          />
          <line x1="7.5" y1="7" x2="16.5" y2="16" />
          <line x1="16.5" y1="7" x2="7.5" y2="16" />
        </svg>
      );
    case "sigma":
      return (
        <svg
          {...props}
          fill="none"
          stroke={c}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 5 H7 L13 12 L7 19 H17" />
        </svg>
      );
    case "military-sup":
      return (
        <svg
          {...props}
          fill="none"
          stroke={c}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12 C5 7 8 4 12 4 C16 4 19 7 19 12" />
          <path d="M5 12 C5 17 8 20 12 20 C16 20 19 17 19 12" />
          <path d="M5.5 9 L4 8.5 M5.5 13 L4 13 M5.5 16 L4 16.5" opacity="0.6" />
          <path
            d="M18.5 9 L20 8.5 M18.5 13 L20 13 M18.5 16 L20 16.5"
            opacity="0.6"
          />
          <line x1="9" y1="9" x2="15" y2="15" stroke={a} />
          <line x1="15" y1="9" x2="9" y2="15" stroke={a} />
        </svg>
      );
    case "scientific-sup":
      return (
        <svg
          {...props}
          fill="none"
          stroke={c}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12 C5 7 8 4 12 4 C16 4 19 7 19 12" />
          <path d="M5 12 C5 17 8 20 12 20 C16 20 19 17 19 12" />
          <path d="M5.5 9 L4 8.5 M5.5 13 L4 13 M5.5 16 L4 16.5" opacity="0.6" />
          <path
            d="M18.5 9 L20 8.5 M18.5 13 L20 13 M18.5 16 L20 16.5"
            opacity="0.6"
          />
          <path
            d="M8 9 L12 11 L16 9 L16 15 L12 17 L8 15 Z"
            fill={a}
            fillOpacity="0.12"
            stroke={a}
          />
          <line x1="12" y1="11" x2="12" y2="17" stroke={a} />
        </svg>
      );
  }
}

/** Category IDs that map to color tokens — useful for typed iteration. */
export const SCORING_CATEGORIES: readonly Exclude<
  CatGlyphId,
  "sigma" | "military-sup" | "scientific-sup"
>[] = [
  "civil",
  "scientific",
  "commercial",
  "guilds",
  "wonders",
  "progress",
  "treasury",
  "military",
] as const;
