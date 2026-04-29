export type Player = {
  id: string;
  name: string;
  position: number;
  /** Linked user (when the Player was attributed via the self chip).
   * Preferred display name = user.alias ?? user.name ?? player.name. */
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
