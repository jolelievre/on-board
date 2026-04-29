import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { authClient } from "../../lib/auth-client";
import { LanguageSelector } from "../../components/LanguageSelector";
import { ThemeToggle } from "../../components/ui/ThemeToggle";
import { Header } from "../../components/layout/Header";
import { Group } from "../../components/ui/Group";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import styles from "./settings.module.css";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const initial = session?.user.name?.trim().slice(0, 1).toUpperCase() ?? "·";

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

          <Group title={t("settings.language")}>
            <LanguageSelector />
          </Group>

          <Group
            title={t("settings.theme.title", { defaultValue: "Theme" })}
          >
            <ThemeToggle />
          </Group>

          <Button
            type="button"
            onClick={() => authClient.signOut()}
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
