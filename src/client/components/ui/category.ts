/**
 * Helpers to address per-category theme tokens via CSS variables.
 *
 * The 8 7-Wonders-Duel categories are: civil, scientific, commercial, guilds,
 * wonders, progress, treasury, military. Each has `bg`, `strong`, and `ink`
 * shades defined in `tokens.css` / `themes/*.css`.
 */

export type Category =
  | "civil"
  | "scientific"
  | "commercial"
  | "guilds"
  | "wonders"
  | "progress"
  | "treasury"
  | "military";

export type CategoryShade = "bg" | "strong" | "ink";

/** Returns the CSS variable reference for a category shade. */
export function categoryColor(cat: Category, shade: CategoryShade): string {
  return `var(--color-cat-${cat}-${shade})`;
}

/**
 * Map a server-side scoring-category id to our visual category.
 *
 * The DB persists `scientific_progress` for the "Progress" category in
 * 7 Wonders Duel; the design uses the shorter `progress` id everywhere else.
 * Centralize the mapping so screens can just pass the server id.
 */
export function categoryFromScoringId(id: string): Category | null {
  switch (id) {
    case "civil":
    case "scientific":
    case "commercial":
    case "guilds":
    case "wonders":
    case "treasury":
    case "military":
      return id;
    case "scientific_progress":
    case "progress":
      return "progress";
    default:
      return null;
  }
}
