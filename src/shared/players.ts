/**
 * Shared display-name resolution for a Player record.
 *
 * Priority:
 *   1. linked User.alias (if set)
 *   2. linked User.name (if linked)
 *   3. Player.name (snapshot at match creation, used for unlinked players)
 *
 * Use this everywhere a player's name is rendered — history list, scoring
 * grid, winner banner — so renaming via Settings (alias) takes effect
 * across past matches retroactively.
 */
export type PlayerDisplayInput = {
  name: string;
  user?: {
    name: string;
    alias?: string | null;
  } | null;
};

export function displayPlayerName(player: PlayerDisplayInput): string {
  const alias = player.user?.alias?.trim();
  if (alias) return alias;
  const userName = player.user?.name?.trim();
  if (userName) return userName;
  return player.name;
}
