import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/matches/$id")({
  component: MatchPage,
});

function MatchPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-lg p-4">
      <h1 className="text-2xl font-bold">{t("matches.title")}</h1>
      <p className="mt-2 text-gray-500">
        {t("matches.placeholder", { id })}
      </p>
    </div>
  );
}
