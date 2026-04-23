import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/games/$slug")({
  component: GameDetailPage,
});

type Game = {
  id: string;
  slug: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
};

function GameDetailPage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();

  const { data: game, isPending } = useQuery<Game>({
    queryKey: ["games", slug],
    queryFn: async () => {
      const res = await fetch(`/api/games/${slug}`);
      if (!res.ok) throw new Error("Game not found");
      return res.json();
    },
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-red-500">{t("games.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-4">
      <Link to="/games" className="text-sm text-blue-600 hover:underline">
        &larr; {t("nav.games")}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{game.name}</h1>
      <p className="mt-2 text-gray-600">{game.description}</p>
      <p className="mt-1 text-sm text-gray-400">
        {game.minPlayers}–{game.maxPlayers} {t("games.players")}
      </p>

      <div className="mt-6">
        <h2 className="text-lg font-semibold">{t("games.matchHistory")}</h2>
        <p className="mt-2 text-sm text-gray-400">{t("games.noMatches")}</p>
      </div>
    </div>
  );
}
