import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient, updateProfile } from "../../lib/auth-client";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { clearSessionCache } from "../../hooks/useAuthSession";
import { LanguageSelector } from "../../components/LanguageSelector";
import { ThemeToggle } from "../../components/ui/ThemeToggle";
import { Header } from "../../components/layout/Header";
import { Group } from "../../components/ui/Group";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import styles from "./settings.module.css";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const { canInstall, install } = useInstallPrompt();
  const displayName =
    (session?.user as { alias?: string | null } | undefined)?.alias?.trim() ||
    session?.user.name ||
    "";
  const initial = displayName.slice(0, 1).toUpperCase() || "·";

  return (
    <>
      <Header />

      <div className="px-5">
        <h1 className={styles.title}>{t("settings.title")}</h1>

        <div className={styles.body}>
          {session && (
            <div className={styles.profileCard}>
              <span className={styles.avatar}>
                {session.user.image ? (
                  <img src={session.user.image} alt="" />
                ) : (
                  initial
                )}
              </span>
              <div className={styles.profileBody}>
                <p className={styles.profileName}>{session.user.name}</p>
                <p className={styles.profileEmail}>{session.user.email}</p>
              </div>
            </div>
          )}

          <Group
            title={t("settings.alias.title", { defaultValue: "Alias" })}
          >
            <AliasInput
              initialValue={
                (session?.user as { alias?: string | null } | undefined)
                  ?.alias ?? ""
              }
            />
            <p className={styles.hint}>{t("settings.alias.hint")}</p>
          </Group>

          <Group title={t("settings.language")}>
            <LanguageSelector />
          </Group>

          <Group
            title={t("settings.theme.title", { defaultValue: "Theme" })}
          >
            <ThemeToggle />
          </Group>

          {canInstall && (
            <Group title={t("settings.install.title", { defaultValue: "Install app" })}>
              <p className={styles.hint}>
                {t("settings.install.hint", { defaultValue: "Add OnBoard to your home screen for quick access" })}
              </p>
              <Button
                type="button"
                onClick={() => void install()}
                variant="secondary"
                size="md"
                fullWidth
                iconBefore={<Icon name="plus" size={16} />}
                data-testid="install-app-button"
              >
                {t("settings.install.cta", { defaultValue: "Add to home screen" })}
              </Button>
            </Group>
          )}

          <Button
            type="button"
            onClick={() => { clearSessionCache(); void authClient.signOut(); }}
            variant="destructive"
            size="md"
            fullWidth
            iconBefore={<Icon name="logout" size={16} />}
            className={styles.signOut}
          >
            {t("auth.signOut")}
          </Button>
        </div>
      </div>
    </>
  );
}

function AliasInput({ initialValue }: { initialValue: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const [persisted, setPersisted] = useState(initialValue);
  const [showSaved, setShowSaved] = useState(false);

  // Hydrate from session as soon as it lands
  useEffect(() => {
    setValue(initialValue);
    setPersisted(initialValue);
  }, [initialValue]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed === persisted) return;
    setPersisted(trimmed);
    setValue(trimmed);
    void updateProfile({ alias: trimmed })
      .then(() => {
        setShowSaved(true);
        window.setTimeout(() => setShowSaved(false), 1500);
      })
      .catch(() => {
        /* offline / unauthenticated — local change still visible until reload */
      });
  };

  return (
    <div className={styles.aliasRow}>
      <Input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={t("settings.alias.placeholder", { defaultValue: "e.g. Jo" })}
        data-testid="settings-alias-input"
      />
      <span
        className={`${styles.savedBadge} ${showSaved ? styles.savedBadgeVisible : ""}`}
        aria-live="polite"
        data-testid="settings-alias-saved"
      >
        <Icon name="check" size={14} />
        <span>{t("settings.alias.saved", { defaultValue: "Saved" })}</span>
      </span>
    </div>
  );
}
