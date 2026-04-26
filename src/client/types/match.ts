export type Player = {
  id: string;
  name: string;
  position: number;
};

export type ScoreRow = {
  playerId: string;
  category: string;
  value: number;
};

export type Match = {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  victoryType: string | null;
  winnerId: string | null;
  game: { id: string; slug: string; name: string };
  players: Player[];
  scores: ScoreRow[];
};
