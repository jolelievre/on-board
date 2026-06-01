import type { AvatarFrame, AvatarRing } from "../lib/db";

export type PlayerProfile = {
  id: string;
  ownerId: string;
  linkedUserId: string | null;
  alias: string;
  customAvatarUrl: string | null;
  useLinkedAvatar: boolean;
  /** Phase 7 stamp fields — same semantics as `LocalProfile`. The
   * denormalized projection on Player rows carries them so every
   * scoring surface can render the owner's chosen stamp without an
   * extra lookup. */
  avatarFrame: AvatarFrame;
  avatarRing: AvatarRing;
  linkedUser: {
    id: string;
    name: string;
    alias: string | null;
    avatarUrl: string | null;
  } | null;
};

export type Player = {
  id: string;
  position: number;
  profileId: string;
  /** Denormalized Profile join — populated by `useMatch` /
   * `useMatchList`. Always present under the single-Profile model;
   * display code resolves the name and avatar through this object. */
  profile: PlayerProfile;
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
