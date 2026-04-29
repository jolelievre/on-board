import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "../lib/auth-client";
import { LanguageSelector } from "../components/LanguageSelector";
import { Logo } from "../components/ui/Logo";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import styles from "./index.module.css";

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
        <p style={{ color: "var(--color-ink-faint)" }}>{t("common.loading")}</p>
      </div>
    );
  }

  if (session) {
    return null;
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <Logo size={84} glyphOnly animate loop />
        <h1 className={styles.title}>{t("app.name")}</h1>
        <p className={styles.tagline}>{t("app.tagline")}</p>
      </div>

      <div className={styles.middleSpacer} />

      <div className={`${styles.actions} ${styles.actionsBlock}`}>
        {!import.meta.env.VITE_TEST_AUTH && (
          <button
            type="button"
            onClick={() =>
              authClient.signIn.social({ provider: "google", callbackURL: "/games" })
            }
            className={styles.googleButton}
          >
            <GoogleGlyph />
            {t("auth.signInWithGoogle")}
          </button>
        )}

        {import.meta.env.VITE_TEST_AUTH && (
          <>
            <div className={styles.divider}>
              <span className={styles.dividerLine} />
              {t("auth.or", { defaultValue: "or" })}
              <span className={styles.dividerLine} />
            </div>
            <TestAuthForm />
          </>
        )}
      </div>

      <div className={styles.bottom}>
        <LanguageSelector />
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.4h4.8a4.1 4.1 0 01-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2a5.4 5.4 0 01-8.1-2.8H1v2.3A9 9 0 009 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.7a5.4 5.4 0 010-3.4V5H1a9 9 0 000 8z"
      />
      <path
        fill="#EA4335"
        d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.3A9 9 0 001 5l3 2.3A5.4 5.4 0 019 3.6z"
      />
    </svg>
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

    const signIn = await authClient.signIn.email({ email, password });
    if (signIn.error) {
      await authClient.signUp.email({
        email,
        password,
        name: name || t("auth.defaultName"),
      });
    }
    navigate({ to: "/games" });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3"
    >
      <Input
        name="name"
        type="text"
        placeholder={t("auth.name")}
        defaultValue={t("auth.defaultName")}
      />
      <Input
        name="email"
        type="email"
        placeholder={t("auth.email")}
        required
      />
      <Input
        name="password"
        type="password"
        placeholder={t("auth.password")}
        required
      />
      <Button type="submit" variant="primary" fullWidth>
        {t("auth.signIn")}
      </Button>
    </form>
  );
}
