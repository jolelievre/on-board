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

export type DraftPlayer = {
  /** Client-generated id (prefixed "draftp_"). Used wherever the scorer
   * normally references a server player id; rewritten to the real id by
   * the sync engine on flush. */
  id: string;
  name: string;
  position: number;
  userId?: string | null;
};

export type MatchDraft = {
  /** Temporary client-generated ID (prefixed "draft_"). */
  id: string;
  gameId: string;
  gameSlug: string;
  gameName: string;
  players: DraftPlayer[];
  startedAt: string;
  /** Filled by the sync engine once the draft has been replayed against
   * the server. The match route reads this to redirect a stale
   * `/matches/draft_xxx` URL to `/matches/<realId>`. */
  realId?: string;
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
