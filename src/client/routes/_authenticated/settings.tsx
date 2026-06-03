import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { authClient, updateProfile } from "../../lib/auth-client";
import {
  refreshLocalAliases,
  setSyncMeta,
  SYNC_META_FAILED_BANNER_ACK,
} from "../../lib/pull-sync";
import { db, type SyncQueueEntry } from "../../lib/db";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { clearSessionCache } from "../../hooks/useAuthSession";
import { useRequiredViewerId } from "../../hooks/useRequiredViewerId";
import { useSelfProfile } from "../../hooks/data/useProfiles";
import { LanguageSelector } from "../../components/LanguageSelector";
import { ThemeToggle } from "../../components/ui/ThemeToggle";
import { Header } from "../../components/layout/Header";
import { Group } from "../../components/ui/Group";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { EditableAvatar } from "../../components/profiles/EditableAvatar";
import styles from "./settings.module.css";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const viewerId = useRequiredViewerId();
  const { canInstall, install, showIOSHint } = useInstallPrompt();
  const selfProfile = useSelfProfile(viewerId);

  return (
    <>
      <Header />

      <div className="px-5">
        <h1 className={styles.title}>{t("settings.title")}</h1>

        <div className={styles.body}>
          {session && (
            <div className={styles.profileHero}>
              {selfProfile && (
                <EditableAvatar
                  profile={selfProfile}
                  viewerId={session.user.id}
                  size="xl"
                />
              )}
              <p className={styles.profileName}>{session.user.name}</p>
              <p className={styles.profileEmail}>{session.user.email}</p>
            </div>
          )}

          <Group
            title={t("settings.alias.title", { defaultValue: "Alias" })}
          >
            {/* Render only when session is known. AliasInput's commit
                path depends on session.user.id to refresh the cached
                Profile rows linked to the current user; rendering
                before session is loaded lets a fast test (or user)
                fill + blur before myUserId is set, skipping the
                refresh and leaving stale data. */}
            {session && (
              <AliasInput
                initialValue={
                  (session.user as { alias?: string | null }).alias ?? ""
                }
                userId={session.user.id}
              />
            )}
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

          <Group title={t("settings.sync.title")}>
            <SyncPanel />
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

          {showIOSHint && (
            <Group title={t("settings.install.title", { defaultValue: "Install app" })}>
              <p className={styles.hint} data-testid="install-ios-hint">
                {t("settings.install.iosHint", {
                  defaultValue:
                    "On iOS, tap the Share button in Safari, then \"Add to Home Screen\".",
                })}
              </p>
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

          <nav className={styles.legalLinks} aria-label="legal">
            <Link to="/privacy">{t("legal.privacy.title")}</Link>
            <span aria-hidden>·</span>
            <Link to="/terms">{t("legal.terms.title")}</Link>
          </nav>
        </div>
      </div>
    </>
  );
}

function AliasInput({
  initialValue,
  userId,
}: {
  initialValue: string;
  userId: string;
}) {
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
      .then(async () => {
        // Mirror the new alias into Dexie's player.user rows for this
        // user. pullSync alone is insufficient: alias edits don't bump
        // Match.updatedAt server-side, so the LWW merge would skip
        // every match and leave the cached `player.user.alias` stale.
        // The saved badge means "everything in sync". The suggestions
        // list picks up the new alias via authClient.useSession() —
        // no manual invalidation needed.
        await refreshLocalAliases(userId, trimmed === "" ? null : trimmed);
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

/** Phase 8-E sync queue diagnostic panel. Renders every entry in the
 * local sync queue grouped by status so the user can see what's stuck
 * and copy the server's error message to the maintainer.
 *
 * Read-only: Retry / Discard actions ship with PR 8-F. Opening this
 * panel also acknowledges the app-shell `SyncFailedBanner` — the ack
 * writes the current time into `syncMeta.failedBannerAcknowledgedAt`,
 * which suppresses the banner until a *new* failure lands afterwards.
 */
function SyncPanel() {
  const { t, i18n } = useTranslation();

  const liveEntries = useLiveQuery(
    () => db.syncQueue.orderBy("createdAt").toArray(),
    [],
  );
  const entries: SyncQueueEntry[] = liveEntries ?? [];

  // Ack the banner whenever this component is mounted. The banner reads
  // `syncMeta.failedBannerAcknowledgedAt` against the queue's max
  // `failedAt`; bumping the ack to "now" silences any prior failures
  // and lets a future failure re-arm.
  useEffect(() => {
    void setSyncMeta(SYNC_META_FAILED_BANNER_ACK, new Date().toISOString());
  }, []);

  const pending = entries.filter((e) => e.status === "pending");
  const failed = entries.filter((e) => e.status === "failed");

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div data-testid="settings-sync-panel">
      {failed.length > 0 ? (
        <p
          className={`${styles.syncSummary} ${styles.syncSummaryFailed}`}
          data-testid="sync-summary-failed"
        >
          <Icon name="info" size={16} />
          <span>{t("settings.sync.failed", { count: failed.length })}</span>
        </p>
      ) : pending.length > 0 ? (
        <p
          className={`${styles.syncSummary} ${styles.syncSummaryPending}`}
          data-testid="sync-summary-pending"
        >
          <Icon name="refresh" size={16} />
          <span>{t("settings.sync.pending", { count: pending.length })}</span>
        </p>
      ) : (
        <p
          className={`${styles.syncSummary} ${styles.syncSummaryOk}`}
          data-testid="sync-summary-ok"
        >
          <Icon name="check" size={16} />
          <span>{t("settings.sync.ok")}</span>
        </p>
      )}

      <p className={styles.hint}>
        {failed.length > 0
          ? t("settings.sync.failedHint")
          : pending.length > 0
            ? t("settings.sync.pendingHint")
            : t("settings.sync.okHint")}
      </p>

      {entries.length > 0 && (
        <ul className={styles.syncList} data-testid="sync-entry-list">
          {entries.map((entry) => (
            <SyncEntryRow
              key={entry.id ?? `${entry.createdAt}-${entry.url}`}
              entry={entry}
              dateFormatter={dateFormatter}
            />
          ))}
        </ul>
      )}

      {failed.length > 0 && (
        <p className={styles.hint} data-testid="sync-no-actions-yet">
          {t("settings.sync.noActionsYet")}
        </p>
      )}
    </div>
  );
}

function SyncEntryRow({
  entry,
  dateFormatter,
}: {
  entry: SyncQueueEntry;
  dateFormatter: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation();
  const path = stripQueryString(entry.url);
  const message = entry.errorBody?.error ?? entry.error;
  const isFailed = entry.status === "failed";

  return (
    <li
      className={`${styles.syncEntry} ${isFailed ? styles.syncEntryFailed : ""}`}
      data-testid="sync-entry"
      data-status={entry.status}
    >
      <div className={styles.syncEntryHeader}>
        <span>{t("settings.sync.entryLabel", { method: entry.method, path })}</span>
        {entry.errorStatus !== undefined && (
          <span className={styles.syncEntryStatus}>
            {t("settings.sync.entryStatus", { status: entry.errorStatus })}
          </span>
        )}
      </div>

      {isFailed && (
        <p
          className={styles.syncEntryMessage}
          data-testid="sync-entry-error-message"
        >
          {message ?? t("settings.sync.entryUnknown")}
        </p>
      )}

      {entry.errorBody?.field && (
        <p className={styles.syncEntryMeta}>
          {t("settings.sync.entryField", { field: entry.errorBody.field })}
        </p>
      )}

      {entry.errorBody?.hint && (
        <p className={styles.syncEntryMeta}>
          {t("settings.sync.entryHint", { hint: entry.errorBody.hint })}
        </p>
      )}

      <p className={styles.syncEntryMeta}>
        {entry.retries > 0 &&
          `${t("settings.sync.entryRetries", { count: entry.retries })} · `}
        {entry.failedAt
          ? t("settings.sync.entryFailedAt", {
              when: dateFormatter.format(new Date(entry.failedAt)),
            })
          : dateFormatter.format(new Date(entry.createdAt))}
      </p>
    </li>
  );
}

function stripQueryString(url: string): string {
  const queryAt = url.indexOf("?");
  return queryAt === -1 ? url : url.slice(0, queryAt);
}
