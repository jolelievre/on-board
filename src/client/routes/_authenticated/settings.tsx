import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { authClient } from "../../lib/auth-client";
import { LanguageSelector } from "../../components/LanguageSelector";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();

  return (
    <div className="mx-auto max-w-lg p-4">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>

      {session && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">{t("settings.profile")}</h2>
          <div className="mt-3 flex items-center gap-3">
            {session.user.image && (
              <img
                src={session.user.image}
                alt=""
                className="h-12 w-12 rounded-full"
              />
            )}
            <div>
              <p className="font-medium">{session.user.name}</p>
              <p className="text-sm text-gray-500">{session.user.email}</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-lg font-semibold">{t("settings.language")}</h2>
        <div className="mt-3">
          <LanguageSelector />
        </div>
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={() => authClient.signOut()}
          className="rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100"
        >
          {t("auth.signOut")}
        </button>
      </div>
    </div>
  );
}
