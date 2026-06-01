/**
 * Brand glyphs for the OAuth providers we support on the login screen.
 * Each is a single inline SVG so the login page works fully offline (no
 * runtime font / icon fetch) and so the brand colours are baked in to
 * match each provider's UI guidelines.
 */
import type { JSX } from "react";

export type SocialProviderId = "google" | "facebook";

type GlyphProps = { size?: number };

export function GoogleGlyph({ size = 18 }: GlyphProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.4h4.8a4.1 4.1 0 01-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2a5.4 5.4 0 01-8.1-2.8H1v2.3A9 9 0 009 18z"
      />
      <path fill="#FBBC05" d="M3.96 10.7a5.4 5.4 0 010-3.4V5H1a9 9 0 000 8z" />
      <path
        fill="#EA4335"
        d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.3A9 9 0 001 5l3 2.3A5.4 5.4 0 019 3.6z"
      />
    </svg>
  );
}

export function FacebookGlyph({ size = 18 }: GlyphProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#1877F2"
        d="M18 9a9 9 0 10-10.4 8.9v-6.3H5.3V9h2.3V7c0-2.3 1.4-3.5 3.4-3.5.7 0 1.5.1 1.9.2v2.2h-1.2c-1.1 0-1.4.6-1.4 1.3V9h2.6l-.4 2.6h-2.2v6.3A9 9 0 0018 9z"
      />
    </svg>
  );
}

export const PROVIDER_GLYPHS: Record<SocialProviderId, (p: GlyphProps) => JSX.Element> = {
  google: GoogleGlyph,
  facebook: FacebookGlyph,
};

/** Ordered list of providers — drives the on-screen button order. */
export const PROVIDER_ORDER: SocialProviderId[] = ["google", "facebook"];
