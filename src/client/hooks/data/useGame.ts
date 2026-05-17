import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalGame } from "../../lib/db";

export type DataStatus = "loading" | "ok" | "missing";

export type UseGameResult = {
  data: LocalGame | undefined;
  status: DataStatus;
};

/** Reactive read of a single game by slug. */
export function useGame(slug: string): UseGameResult {
  const data = useLiveQuery(
    async (): Promise<LocalGame | null> => {
      const game = await db.games.where("slug").equals(slug).first();
      return game ?? null;
    },
    [slug],
  );

  if (data === undefined) return { data: undefined, status: "loading" };
  if (data === null) return { data: undefined, status: "missing" };
  return { data, status: "ok" };
}
