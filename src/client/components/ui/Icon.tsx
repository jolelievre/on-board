export type IconName =
  | "arrow-left"
  | "plus"
  | "minus"
  | "check"
  | "globe"
  | "user"
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
  | "play";

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
  }
}
