import { prisma } from "./prisma.js";

/**
 * Open Graph SSR helper for the public match share page (PR 8-D).
 *
 * Chat apps and link previews (iMessage, Slack, Discord, WhatsApp)
 * fetch the URL with no JS execution — they read meta tags from the
 * initial HTML response. The SPA shell that the browser loads cannot
 * populate those tags client-side fast enough to be picked up. So
 * `/share/:token` is special-cased on both prod and dev paths: read
 * the SPA shell, inject `<meta property="og:*">` tags built from the
 * share payload, then return the modified HTML. The client SPA
 * still hydrates from `/api/share/:token` as before — the injected
 * tags are purely for the crawler's first pass.
 *
 * Single-purpose exception to the SPA-only stance; if other surfaces
 * ever need SSR, factor a generic page-meta handler rather than
 * generalising this one.
 */

export type ShareOgPayload = {
  title: string;
  description: string;
};

/**
 * Build the OG payload for a given share token, or null when the
 * token doesn't exist or the underlying match isn't completed.
 * The caller decides what to do with null — typically "serve the
 * shell without injection so the SPA shows its own not-found state".
 */
export async function buildShareOgPayload(
  token: string,
): Promise<ShareOgPayload | null> {
  const row = await prisma.matchShareToken.findUnique({
    where: { id: token },
    include: {
      match: {
        include: {
          game: { select: { name: true } },
          players: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              profile: { select: { alias: true } },
            },
          },
          scores: { select: { playerId: true, value: true } },
        },
      },
    },
  });
  // Tombstoned matches (Phase 8-G) produce no OG payload — the chat-app
  // crawler will then see the SPA's own not-found state.
  if (
    !row ||
    row.match.status !== "COMPLETED" ||
    row.match.deletedAt !== null
  )
    return null;

  const totalByPlayer = new Map<string, number>();
  for (const s of row.match.scores) {
    totalByPlayer.set(
      s.playerId,
      (totalByPlayer.get(s.playerId) ?? 0) + s.value,
    );
  }

  const winnerRow = row.match.players.find(
    (p) => p.id === row.match.winnerId,
  );
  const summary = row.match.players
    .map((p) => `${p.profile.alias} ${totalByPlayer.get(p.id) ?? 0}`)
    .join(" · ");

  const title = winnerRow
    ? `${winnerRow.profile.alias} won — ${row.match.game.name}`
    : `${row.match.game.name} match`;

  return { title, description: summary };
}

/**
 * Render the OG meta tag block. Caller owns the surrounding `<head>`
 * and merges this string in (typically by replacing the closing tag).
 */
export function buildShareOgTags(
  payload: ShareOgPayload,
  url: string,
  imageUrl: string,
): string {
  const e = escapeHtml;
  // Most chat-app unfurls (Messenger, WhatsApp, iMessage, Signal,
  // Slack) need explicit `og:image:width` / `og:image:height` to
  // render the preview thumbnail consistently — without them the
  // image is sometimes dropped silently. The pwa-icon is square 512.
  return [
    `<meta property="og:title" content="${e(payload.title)}" />`,
    `<meta property="og:description" content="${e(payload.description)}" />`,
    `<meta property="og:url" content="${e(url)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="OnBoard" />`,
    `<meta property="og:image" content="${e(imageUrl)}" />`,
    `<meta property="og:image:width" content="512" />`,
    `<meta property="og:image:height" content="512" />`,
    `<meta property="og:image:alt" content="OnBoard" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${e(payload.title)}" />`,
    `<meta name="twitter:description" content="${e(payload.description)}" />`,
    `<meta name="twitter:image" content="${e(imageUrl)}" />`,
  ].join("\n    ");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Merge the OG block into an HTML string. Returns the original HTML
 * unchanged when no payload is provided — the SPA still renders and
 * shows its own not-found state. Returns the HTML with tags inserted
 * just before `</head>` when a payload is provided.
 */
export function injectShareOg(
  html: string,
  payload: ShareOgPayload | null,
  url: string,
  imageUrl: string,
): string {
  if (!payload) return html;
  const tags = buildShareOgTags(payload, url, imageUrl);
  if (html.includes("</head>")) {
    return html.replace("</head>", `    ${tags}\n  </head>`);
  }
  // Defensive fallback — shouldn't happen with a well-formed SPA shell.
  return `${tags}\n${html}`;
}
