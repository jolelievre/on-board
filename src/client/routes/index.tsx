import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "../lib/auth-client";
import { LanguageSelector } from "../components/LanguageSelector";

export const Route = createFileRoute("/")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (session) {
      navigate({ to: "/games" });
    }
  }, [session, navigate]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">{t("common.loading")}</p>
      </div>
    );
  }

  if (session) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">{t("app.name")}</h1>
        <p className="mt-2 text-gray-600">{t("app.tagline")}</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        {!import.meta.env.VITE_TEST_AUTH && (
          <button
            type="button"
            onClick={() =>
              authClient.signIn.social({ provider: "google", callbackURL: "/games" })
            }
            className="rounded-lg bg-white px-4 py-3 font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50"
          >
            {t("auth.signInWithGoogle")}
          </button>
        )}

        {import.meta.env.VITE_TEST_AUTH && <TestAuthForm />}
      </div>

      <div className="mt-4">
        <LanguageSelector />
      </div>
    </div>
  );
}

function TestAuthForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;
    const name = form.get("name") as string;

    // Try sign in first, fall back to sign up
    const signIn = await authClient.signIn.email({ email, password });
    if (signIn.error) {
      await authClient.signUp.email({ email, password, name: name || t("auth.defaultName") });
    }
    navigate({ to: "/games" });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        name="name"
        type="text"
        placeholder={t("auth.name")}
        defaultValue={t("auth.defaultName")}
        className="rounded-lg border px-4 py-3"
      />
      <input
        name="email"
        type="email"
        placeholder={t("auth.email")}
        required
        className="rounded-lg border px-4 py-3"
      />
      <input
        name="password"
        type="password"
        placeholder={t("auth.password")}
        required
        className="rounded-lg border px-4 py-3"
      />
      <button
        type="submit"
        className="rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
      >
        {t("auth.signIn")}
      </button>
    </form>
  );
}
