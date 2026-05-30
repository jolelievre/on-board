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

/** Embedded Profile projection on each Player row. The server always
 * projects the full Profile (plus its linked-user join) on match
 * responses so the client can render any player without a separate
 * Profile lookup, even when the viewer can't pull the Profile row
 * standalone (e.g. a friend's self-Profile). */
export type ApiPlayerProfile = {
  id: string;
  ownerId: string;
  linkedUserId: string | null;
  alias: string;
  customAvatarUrl: string | null;
  useLinkedAvatar: boolean;
  linkedUser: {
    id: string;
    name: string;
    alias: string | null;
    avatarUrl: string | null;
  } | null;
};

export type ApiPlayer = {
  id: string;
  matchId?: string;
  profileId: string;
  position: number;
  profile: ApiPlayerProfile;
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
  /** Shown on the linked-friend card so the owner can verify the
   * link target. Added in PR 6-C. */
  email: string;
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
