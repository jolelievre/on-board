import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalGame } from "../../lib/db";

export type DataStatus = "loading" | "ok";

export type UseGamesResult = {
  data: LocalGame[] | undefined;
  status: DataStatus;
};

/** Reactive list of all known games. Catalogue is small (≤ a dozen)
 * so we don't bother paginating or filtering at the query layer. */
export function useGames(): UseGamesResult {
  const data = useLiveQuery(async (): Promise<LocalGame[]> => {
    const rows = await db.games.toArray();
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, []);

  if (data === undefined) return { data: undefined, status: "loading" };
  return { data, status: "ok" };
}
