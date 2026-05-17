import { createId } from "@paralleldrive/cuid2";
import {
  db,
  type LocalMatch,
  type LocalPlayer,
  type LocalScore,
} from "./db";
import { syncEngine } from "./sync";

const nowIso = () => new Date().toISOString();

/** Fire-and-forget flush after every local write. Synchronous from the
 * caller's perspective: the Dexie write has already committed, and the
 * UI's `useLiveQuery` will rerender on its own. Network errors are
 * absorbed (retries handled by the sync queue). */
function scheduleFlush(): void {
  void syncEngine.flush().catch(() => {
    /* surfaced via syncQueue retries */
  });
}

export type CreateMatchInput = {
  gameId: string;
  players: { name: string; userId?: string | null }[];
  /** Pre-supplied id (tests/replay). Otherwise generated. */
  id?: string;
  metadata?: Record<string, unknown>;
};

export type CreateMatchResult = {
  matchId: string;
};

/**
 * Create a match locally. Writes a Match row, one Player row per
 * participant, an empty score set, and a single POST entry in the
 * sync queue. The returned id is a real CUID — never a draft prefix.
 *
 * Acceptance: PR A made `POST /api/matches` upsert idempotently on
 * `id`, so the queued POST is safe to replay any number of times.
 */
export async function createMatch(
  input: CreateMatchInput,
): Promise<CreateMatchResult> {
  const matchId = input.id ?? createId();
  const ts = nowIso();

  const players: LocalPlayer[] = input.players.map((p, position) => ({
    id: createId(),
    matchId,
    name: p.name,
    position,
    userId: p.userId ?? null,
    updatedAt: ts,
  }));

  const match: LocalMatch = {
    id: matchId,
    gameId: input.gameId,
    status: "IN_PROGRESS",
    victoryType: null,
    winnerId: null,
    metadata: input.metadata ?? {},
    startedAt: ts,
    completedAt: null,
    updatedAt: ts,
  };

  await db.transaction(
    "rw",
    [db.matches, db.players, db.syncQueue],
    async () => {
      await db.matches.put(match);
      await db.players.bulkPut(players);
      await db.syncQueue.add({
        method: "POST",
        url: "/api/matches",
        body: JSON.stringify({
          id: matchId,
          gameId: input.gameId,
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
          players: players.map((p) => ({
            id: p.id,
            name: p.name,
            position: p.position,
            ...(p.userId ? { userId: p.userId } : {}),
          })),
        }),
        createdAt: ts,
        retries: 0,
        status: "pending",
      });
    },
  );

  scheduleFlush();
  return { matchId };
}

export type UpsertScoresInput = {
  matchId: string;
  scores: {
    playerId: string;
    category: string;
    value: number;
    metadata?: Record<string, unknown>;
  }[];
};

/**
 * Write one or more score rows to Dexie and enqueue a single PATCH
 * to /api/matches/:id/scores. Rows are keyed on [matchId, playerId,
 * category]; we look up any existing row to preserve its id (and
 * therefore the server-side upsert path).
 */
export async function upsertScores(input: UpsertScoresInput): Promise<void> {
  const ts = nowIso();

  await db.transaction("rw", [db.scores, db.matches, db.syncQueue], async () => {
    const toPut: LocalScore[] = [];
    for (const s of input.scores) {
      const existing = await db.scores
        .where("[matchId+playerId+category]")
        .equals([input.matchId, s.playerId, s.category])
        .first();
      toPut.push({
        id: existing?.id ?? createId(),
        matchId: input.matchId,
        playerId: s.playerId,
        category: s.category,
        value: s.value,
        metadata: s.metadata ?? {},
        updatedAt: ts,
      });
    }
    await db.scores.bulkPut(toPut);
    await touchMatchUpdatedAt(input.matchId, ts);

    await db.syncQueue.add({
      method: "PATCH",
      url: `/api/matches/${input.matchId}/scores`,
      body: JSON.stringify({
        scores: input.scores.map((s) => ({
          playerId: s.playerId,
          category: s.category,
          value: s.value,
          ...(s.metadata !== undefined ? { metadata: s.metadata } : {}),
        })),
      }),
      createdAt: ts,
      retries: 0,
      status: "pending",
    });
  });

  scheduleFlush();
}

export type PatchMatchInput = {
  matchId: string;
  metadata?: Record<string, unknown>;
  playerOrder?: { playerId: string; position: number }[];
};

/**
 * Edit match metadata or reorder players. Mirrors PATCH /api/matches/:id.
 * The server rejects PATCH on a COMPLETED match — we don't pre-check
 * locally (we trust the UI not to expose those affordances) and let
 * the queued PATCH 400 if a stale UI somehow fires one; it'll go to
 * `status: "failed"` in the queue rather than retry forever.
 */
export async function patchMatch(input: PatchMatchInput): Promise<void> {
  const ts = nowIso();

  await db.transaction(
    "rw",
    [db.matches, db.players, db.syncQueue],
    async () => {
      const match = await db.matches.get(input.matchId);
      if (match) {
        const next: LocalMatch = {
          ...match,
          ...(input.metadata !== undefined
            ? { metadata: input.metadata }
            : {}),
          updatedAt: ts,
        };
        await db.matches.put(next);
      } else {
        warnMissingLocalMatch("patchMatch", input.matchId);
      }

      if (input.playerOrder) {
        for (const entry of input.playerOrder) {
          await db.players.update(entry.playerId, {
            position: entry.position,
            updatedAt: ts,
          });
        }
      }

      await db.syncQueue.add({
        method: "PATCH",
        url: `/api/matches/${input.matchId}`,
        body: JSON.stringify({
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
          ...(input.playerOrder ? { playerOrder: input.playerOrder } : {}),
        }),
        createdAt: ts,
        retries: 0,
        status: "pending",
      });
    },
  );

  scheduleFlush();
}

export type CompleteMatchInput = {
  matchId: string;
  victoryType: string;
  winnerId: string | null;
};

/**
 * Mark a match COMPLETED. Mirrors PUT /api/matches/:id with a status
 * transition. Locally writes the new status + outcome fields and
 * `completedAt`, then enqueues the PUT.
 */
export async function completeMatch(input: CompleteMatchInput): Promise<void> {
  const ts = nowIso();

  await db.transaction("rw", [db.matches, db.syncQueue], async () => {
    const match = await db.matches.get(input.matchId);
    if (match) {
      const next: LocalMatch = {
        ...match,
        status: "COMPLETED",
        victoryType: input.victoryType,
        winnerId: input.winnerId,
        completedAt: ts,
        updatedAt: ts,
      };
      await db.matches.put(next);
    } else {
      warnMissingLocalMatch("completeMatch", input.matchId);
    }

    await db.syncQueue.add({
      method: "PUT",
      url: `/api/matches/${input.matchId}`,
      body: JSON.stringify({
        status: "COMPLETED",
        victoryType: input.victoryType,
        winnerId: input.winnerId,
      }),
      createdAt: ts,
      retries: 0,
      status: "pending",
    });
  });

  scheduleFlush();
}

async function touchMatchUpdatedAt(matchId: string, ts: string): Promise<void> {
  const match = await db.matches.get(matchId);
  if (match) {
    await db.matches.update(matchId, { updatedAt: ts });
  } else {
    warnMissingLocalMatch("touchMatchUpdatedAt", matchId);
  }
}

/** Surface — without throwing — the rare case where a mutation runs for
 * a match that isn't mirrored locally. Either pullSync hasn't caught up,
 * the user navigated to a server-only match in a way the data hooks
 * shouldn't allow, or Dexie was wiped mid-session. The queued network
 * request still fires (server is authoritative), but a stale local view
 * would be the only symptom — worth a log. */
function warnMissingLocalMatch(op: string, matchId: string): void {
  console.warn(
    `[mutations.${op}] match ${matchId} not found in Dexie; ` +
      `queueing server request without local mirror update.`,
  );
}
