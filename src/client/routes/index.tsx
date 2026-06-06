import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { authClient } from "../lib/auth-client";
import { useAuthSession } from "../hooks/useAuthSession";
import { LanguageSelector } from "../components/LanguageSelector";
import { Logo } from "../components/ui/Logo";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import {
  PROVIDER_GLYPHS,
  PROVIDER_ORDER,
  type SocialProviderId,
} from "../components/auth/providerGlyphs";
import styles from "./index.module.css";

export const Route = createFileRoute("/")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // A cached session is sufficient to enter the app — even offline. The
  // protected routes own the offline UX (OfflineBanner, SyncPill, the
  // offlineNoCache fallback for queries with no cached data), so there's
  // nothing harmful about redirecting an offline-fallback user to /games.
  const { session, isPending } = useAuthSession();

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
        {/* Brand wordmark — split into two color tones to match the design.
         * "OnBoard" is the fixed brand name (not localized via t()). */}
        <h1 className={styles.title} aria-label={t("app.name")}>
          <span className={styles.titleOn}>On</span>
          <span className={styles.titleBoard}>Board</span>
        </h1>
        <p className={styles.tagline}>{t("app.tagline")}</p>
      </div>

      <div className={styles.middleSpacer} />

      <div className={`${styles.actions} ${styles.actionsBlock}`}>
        {!import.meta.env.VITE_TEST_AUTH && <SocialProviderButtons />}

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

      <p className={styles.legalFooter}>
        <Trans
          i18nKey="auth.legalFooter"
          components={{
            termsLink: <Link to="/terms" />,
            privacyLink: <Link to="/privacy" />,
          }}
        />
      </p>

      <p className={styles.installLink}>
        <Link to="/install" data-testid="login-install-link">
          {t("install.loginLink")}
        </Link>
      </p>

      <div className={styles.bottom}>
        <LanguageSelector />
      </div>
    </div>
  );
}

/**
 * Render one button per OAuth provider that the server has credentials for.
 * The server-side `/api/auth/providers` endpoint is the source of truth —
 * a provider whose env vars aren't set on this deploy simply doesn't
 * render, even if the client code knows about it.
 */
function SocialProviderButtons() {
  const { t } = useTranslation();
  const enabled = useEnabledProviders();

  if (!enabled) {
    return null;
  }

  return (
    <>
      {PROVIDER_ORDER.filter((id) => enabled.includes(id)).map((id) => {
        const Glyph = PROVIDER_GLYPHS[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() =>
              authClient.signIn.social({ provider: id, callbackURL: "/games" })
            }
            className={styles.providerButton}
            data-provider={id}
          >
            <Glyph />
            {t(`auth.signInWith.${id}`)}
          </button>
        );
      })}
    </>
  );
}

/** Fetch the list of OAuth providers configured on the server. */
function useEnabledProviders(): SocialProviderId[] | null {
  const [providers, setProviders] = useState<SocialProviderId[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((r) => r.json() as Promise<{ providers: SocialProviderId[] }>)
      .then((data) => {
        if (!cancelled) setProviders(data.providers);
      })
      .catch(() => {
        // Server unreachable (offline / cold start) — fall back to an
        // empty list, which hides the buttons but keeps the rest of the
        // login page usable. The user can retry once back online.
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return providers;
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
