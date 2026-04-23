import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/games/")({
  component: GamesPage,
});

type Game = {
  id: string;
  slug: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
};

function GamesPage() {
  const { t } = useTranslation();
  const { data: games, isPending } = useQuery<Game[]>({
    queryKey: ["games"],
    queryFn: async () => {
      const res = await fetch("/api/games");
      if (!res.ok) throw new Error("Failed to fetch games");
      return res.json();
    },
  });

  return (
    <div className="mx-auto max-w-lg p-4">
      <h1 className="text-2xl font-bold">{t("games.title")}</h1>

      {isPending && <p className="mt-4 text-gray-500">Loading...</p>}

      {games && (
        <div className="mt-4 flex flex-col gap-3">
          {games.map((game) => (
            <Link
              key={game.id}
              to="/games/$slug"
              params={{ slug: game.slug }}
              className="rounded-lg border p-4 hover:bg-gray-50"
            >
              <h2 className="font-semibold">{game.name}</h2>
              <p className="mt-1 text-sm text-gray-600">{game.description}</p>
              <p className="mt-1 text-xs text-gray-400">
                {game.minPlayers}–{game.maxPlayers} {t("games.players")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
