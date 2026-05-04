import Dexie, { type EntityTable } from "dexie";

export type LocalProfile = {
  /** Name used as the primary key (names are the identity for local profiles). */
  name: string;
  avatarUrl?: string | null;
  /** Set when this profile has been linked to a server user. */
  linkedUserId?: string | null;
  /** ISO timestamp of last time this name was used — used for sorting suggestions. */
  usedAt: string;
  isSelf?: boolean;
};

export type SyncQueueEntry = {
  id?: number;
  method: string;
  url: string;
  body?: string;
  createdAt: string;
  retries: number;
  /** Set when the entry has failed permanently (retries exhausted). */
  error?: string;
};

export type MatchDraft = {
  /** Temporary client-generated ID (prefixed "draft_"). */
  id: string;
  gameId: string;
  gameSlug: string;
  players: { name: string; userId?: string | null }[];
  startedAt: string;
};

class OnBoardDB extends Dexie {
  localProfiles!: EntityTable<LocalProfile, "name">;
  syncQueue!: EntityTable<SyncQueueEntry, "id">;
  matchDrafts!: EntityTable<MatchDraft, "id">;

  constructor() {
    super("onboard");
    this.version(1).stores({
      localProfiles: "name, usedAt, linkedUserId",
      syncQueue: "++id, createdAt, retries",
      matchDrafts: "id, gameId, startedAt",
    });
  }
}

export const db = new OnBoardDB();
