export type IconName =
  | "arrow-left"
  | "plus"
  | "minus"
  | "check"
  | "globe"
  | "user"
  | "users"
  | "logout"
  | "cog"
  | "history"
  | "dice"
  | "home"
  | "cards"
  | "sync"
  | "wifi"
  | "wifi-off"
  | "trophy"
  | "sparkle"
  | "pencil"
  | "x"
  | "play"
  | "link"
  | "camera"
  | "image"
  | "refresh"
  | "merge"
  | "crown"
  | "skull-king"
  | "info"
  | "bar-chart-2"
  | "medal"
  | "flame"
  | "shield"
  | "cards-check"
  | "flag"
  | "zero"
  | "calendar-check"
  | "share";

type Props = {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  title?: string;
};

/**
 * Stroke icon set ported from the design handoff.
 *
 * Uses `currentColor` for stroke + fill where appropriate, so the parent's
 * CSS `color` controls icon color. Pass a `title` for accessibility.
 */
export function Icon({ name, size = 20, stroke = 1.6, className, title }: Props) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    role: title ? "img" : undefined,
    "aria-hidden": title ? undefined : true,
  };

  const titleEl = title ? <title>{title}</title> : null;

  switch (name) {
    case "arrow-left":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M15 18l-6-6 6-6" />
        </svg>
      );
    case "plus":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "minus":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M5 12h14" />
        </svg>
      );
    case "check":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M5 12l5 5L20 7" />
        </svg>
      );
    case "globe":
      return (
        <svg {...props}>
          {titleEl}
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
        </svg>
      );
    case "user":
      return (
        <svg {...props}>
          {titleEl}
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </svg>
      );
    case "logout":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      );
    case "cog":
      return (
        <svg {...props}>
          {titleEl}
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
        </svg>
      );
    case "history":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8" />
          <path d="M3 3v5h5M12 7v5l3 2" />
        </svg>
      );
    case "dice":
      return (
        <svg {...props}>
          {titleEl}
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "home":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M3 11l9-8 9 8v9a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2z" />
        </svg>
      );
    case "cards":
      return (
        <svg {...props}>
          {titleEl}
          <rect x="3" y="6" width="13" height="16" rx="2" />
          <path d="M8 2l9 3-3 12" />
        </svg>
      );
    case "sync":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />
        </svg>
      );
    case "wifi":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0" />
          <circle cx="12" cy="19.5" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "wifi-off":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M2 2l20 20M5 12.5a10 10 0 0110-1.5M8.5 16a5 5 0 015.7-1" />
          <circle cx="12" cy="19.5" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "trophy":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4z" />
          <path d="M7 6H4a3 3 0 003 3M17 6h3a3 3 0 01-3 3" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
        </svg>
      );
    case "pencil":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M16 3l5 5-12 12H4v-5z" />
        </svg>
      );
    case "x":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case "play":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M6 4l14 8-14 8z" fill="currentColor" />
        </svg>
      );
    case "users":
      return (
        <svg {...props}>
          {titleEl}
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" />
          <circle cx="17" cy="6.5" r="2.5" />
          <path d="M16 13.2c3.2.4 5 2.5 5 5.3" />
        </svg>
      );
    case "link":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7L11 7" />
          <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7L13 17" />
        </svg>
      );
    case "camera":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      );
    case "image":
      return (
        <svg {...props}>
          {titleEl}
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 17l5-5 4 4 3-3 6 6" />
          <circle cx="9" cy="9" r="1.5" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />
          <path d="M3 12a9 9 0 0015.7 6L21 16" />
        </svg>
      );
    case "merge":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M6 3v6a4 4 0 004 4h4a4 4 0 014 4v4M18 3v6" />
          <path d="M3 6l3-3 3 3M15 6l3-3 3 3" />
        </svg>
      );
    case "crown":
      // Phase 7 — bold filled crown for the winner badge. Filled with
      // `currentColor` so the consumer (WinnerBadge) drives the colour
      // via CSS — `color: var(--color-crown-gold-ink)` inside a gold disc.
      return (
        <svg {...props} fill="currentColor" stroke="none">
          {titleEl}
          <path
            d="M2.5 7.5 L7 12 L12 4 L17 12 L21.5 7.5 L19.5 19 L4.5 19 Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <rect x="4.5" y="18.5" width="15" height="2.6" rx="1" />
          <circle cx="2.5" cy="7.5" r="1.7" />
          <circle cx="21.5" cy="7.5" r="1.7" />
          <circle cx="12" cy="4" r="1.9" />
        </svg>
      );
    case "info":
      // Lower-case "i" in a circle — used as the universal info /
      // disclosure affordance. Stroke-based to match the rest of the
      // set; the dot is a filled circle for crispness at small sizes.
      return (
        <svg {...props}>
          {titleEl}
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
          <path d="M12 11.5v5" />
        </svg>
      );
    case "bar-chart-2":
      return (
        <svg {...props}>
          {titleEl}
          <path d="M6 20V10M12 20V4M18 20v-7" />
        </svg>
      );
    case "medal":
      // Phase 8 — achievement stamp: rosette + ribbon. Filled disc for
      // the medal body, two ribbon tails behind, so the silhouette
      // reads at small sizes (achievements list cells, ~32px).
      return (
        <svg {...props}>
          {titleEl}
          <path d="M8 3l-3 9 4 1M16 3l3 9-4 1" />
          <circle cx="12" cy="16" r="5" fill="currentColor" stroke="currentColor" />
          <path
            d="M12 13.5l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 15.8l2-.3z"
            fill="var(--color-surface)"
            stroke="none"
          />
        </svg>
      );
    case "flame":
      // Phase 8 — streak achievement glyph. Single-tone flame, filled
      // with currentColor so the parent's CSS theme drives the colour.
      return (
        <svg {...props} fill="currentColor" stroke="currentColor">
          {titleEl}
          <path
            d="M12 2.5c1 2.6.3 4.2-.8 5.6-1.4 1.7-3.5 3.4-3.5 6.3a4.8 4.8 0 008.6 2.9c1.3-1.7 1.4-3.9.4-5.9-.7-1.4-1.7-2.4-1.5-3.7.7.4 1.6 1.3 2 2.3.3-3.4-1.7-6.3-5.2-7.5z"
            strokeLinejoin="round"
          />
          <path
            d="M12 13.5c.6 1 .3 1.9-.4 2.6-.7.7-1.5 1.4-1.5 2.6a2.4 2.4 0 004.5.7c.5-1.3 0-2.6-.9-3.7"
            fill="var(--color-surface)"
            stroke="none"
          />
        </svg>
      );
    case "shield":
      // Heraldic shield — used for "Veteran" / endurance stamps.
      return (
        <svg {...props}>
          {titleEl}
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        </svg>
      );
    case "cards-check":
      // Playing card with a check overlay — used for "Perfect call".
      // Card silhouette mirrors the existing `cards` glyph so the
      // family relationship reads clearly.
      return (
        <svg {...props}>
          {titleEl}
          <rect x="4" y="4" width="13" height="16" rx="2" />
          <path d="M9 9l8 3-3 8" />
          <path d="M14 14l2 2 4-4" strokeWidth={stroke + 0.8} />
        </svg>
      );
    case "flag":
      // Checkered finish-line flag — used for "Wire to wire".
      // Two rows of alternating filled squares give the racing pattern
      // at the small icon size; pole anchors the silhouette on the
      // left so the glyph reads as a flag even without colour.
      return (
        <svg {...props}>
          {titleEl}
          <path d="M5 21V3" />
          <rect x="5" y="4" width="13" height="10" fill="none" />
          <rect x="5" y="4" width="3" height="3" fill="currentColor" stroke="none" />
          <rect x="11" y="4" width="3" height="3" fill="currentColor" stroke="none" />
          <rect x="8" y="7" width="3" height="3" fill="currentColor" stroke="none" />
          <rect x="14" y="7" width="3" height="3" fill="currentColor" stroke="none" />
          <rect x="5" y="10" width="3" height="3" fill="currentColor" stroke="none" />
          <rect x="11" y="10" width="3" height="3" fill="currentColor" stroke="none" />
        </svg>
      );
    case "zero":
      // Numeric "0" inside a stamp ring — used for "Sealed lips"
      // (Skull King 0-bid). Text-based glyph reads cleaner at small
      // sizes than a thick elliptical outline alone.
      return (
        <svg {...props}>
          {titleEl}
          <circle cx="12" cy="12" r="9" />
          <text
            x="12"
            y="16.5"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fontFamily="var(--font-display, serif)"
            fill="currentColor"
            stroke="none"
          >
            0
          </text>
        </svg>
      );
    case "calendar-check":
      // Calendar grid with five dots — one per consecutive day —
      // matches the "Habit" 5-day streak threshold visually.
      return (
        <svg {...props}>
          {titleEl}
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
          <circle cx="7" cy="14" r="1" fill="currentColor" stroke="none" />
          <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
          <circle cx="13" cy="14" r="1" fill="currentColor" stroke="none" />
          <circle cx="16" cy="14" r="1" fill="currentColor" stroke="none" />
          <circle cx="7" cy="17.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "share":
      // iOS-style share glyph: arrow rising out of a tray. Universal
      // enough to read on every platform.
      return (
        <svg {...props}>
          {titleEl}
          <path d="M12 3v13M8 7l4-4 4 4" />
          <path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
        </svg>
      );
    case "skull-king":
      // Phase 7 — crowned-skull mark for Skull King game rows. Single-tone
      // (currentColor) so it fits the project's Icon convention.
      return (
        <svg {...props} fill="currentColor" stroke="none">
          {titleEl}
          {/* Crown atop the skull */}
          <path
            d="M5 9 L8 6.5 L12 4.5 L16 6.5 L19 9 L17.5 13 L6.5 13 Z"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          {/* Skull body */}
          <path d="M6 12 C6 8.5 8.6 6.5 12 6.5 C15.4 6.5 18 8.5 18 12 C18 14.4 16.6 16 15.4 16.6 L15.4 19 L8.6 19 L8.6 16.6 C7.4 16 6 14.4 6 12 Z" />
          {/* Eye sockets — punched out with the page background colour */}
          <circle cx="9.6" cy="12" r="1.7" fill="var(--color-surface)" />
          <circle cx="14.4" cy="12" r="1.7" fill="var(--color-surface)" />
          <rect x="10" y="16.5" width="1.4" height="2.5" fill="var(--color-surface)" />
          <rect x="12.6" y="16.5" width="1.4" height="2.5" fill="var(--color-surface)" />
        </svg>
      );
  }
}
