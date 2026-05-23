/** Shape of the server JSON responses consumed by the client. Mirrors
 * the Prisma model with the joins and serialization the API actually
 * returns: ISO date strings, nested `game` on a match, nested `user`
 * (name + alias) on a player. Kept distinct from the local Dexie row
 * types so the LWW merger in `pull-sync.ts` can compare server payloads
 * against the local mirror without confusing the two. */

export type ApiGame = {
  id: string;
  slug: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  iconUrl?: string | null;
};

export type ApiPlayer = {
  id: string;
  matchId?: string;
  /** Phase 6-A: server resolves a Profile for every Player on create and
   * returns its id here. Older snapshots (pre-6-A persisted cache) may
   * lack the field, hence nullable. */
  profileId?: string | null;
  userId?: string | null;
  name: string;
  position: number;
  user?: { name: string; alias: string | null } | null;
  updatedAt?: string | null;
};

/** Linked-User projection embedded in profile responses so the client can
 * render the canonical avatar / name without an extra `/api/users`
 * lookup. Null when the profile is unclaimed. */
export type ApiProfileLinkedUser = {
  id: string;
  name: string;
  alias: string | null;
  avatarUrl: string | null;
};

export type ApiProfile = {
  id: string;
  ownerId: string;
  linkedUserId: string | null;
  alias: string;
  customAvatarUrl: string | null;
  useLinkedAvatar: boolean;
  usedAt: string;
  createdAt: string;
  updatedAt: string;
  linkedUser: ApiProfileLinkedUser | null;
};

export type ApiScore = {
  id: string;
  matchId?: string;
  playerId: string;
  category: string;
  value: number;
  metadata?: Record<string, unknown>;
  updatedAt?: string | null;
};

export type ApiMatch = {
  id: string;
  gameId: string;
  game?: { id: string; slug: string; name: string };
  createdById?: string | null;
  status: "IN_PROGRESS" | "COMPLETED";
  victoryType?: string | null;
  winnerId?: string | null;
  metadata?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string | null;
  /** Optional in the legacy persisted-cache hydration path; required on
   * fresh `/api/matches` responses (pull-sync narrows defensively). */
  updatedAt?: string | null;
  players?: ApiPlayer[];
  scores?: ApiScore[];
};
