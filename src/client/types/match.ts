export type Player = {
  id: string;
  name: string;
  position: number;
  /** Phase 6-A: the Profile this player participation row resolves to.
   * Nullable for legacy cached rows that pre-date 6-A. */
  profileId?: string | null;
  /** Phase 6-A: denormalized Profile join used by `displayPlayerName`
   * to render the canonical alias retroactively across past matches.
   * Populated by `useMatch` / `useMatchList`; null when the linked
   * Profile hasn't been pulled yet. */
  profile?: {
    alias: string;
    linkedUserId: string | null;
    linkedUser: {
      name: string;
      alias: string | null;
    } | null;
  } | null;
  /** Legacy linked user (set when the player is the match creator).
   * Kept for backward compatibility with the old display path; new code
   * should prefer `displayProfileName(profile, viewerId)`. */
  user?: {
    name: string;
    alias: string | null;
  } | null;
};

export type ScoreRow = {
  playerId: string;
  category: string;
  value: number;
  metadata?: Record<string, unknown>;
};

export type Match = {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  victoryType: string | null;
  winnerId: string | null;
  game: { id: string; slug: string; name: string };
  players: Player[];
  scores: ScoreRow[];
  metadata?: Record<string, unknown>;
};
