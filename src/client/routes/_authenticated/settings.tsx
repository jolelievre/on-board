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
import { syncEngine } from "../../lib/sync";
import { filterOwnedBy } from "../../lib/sync-ownership";
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

/** Sync queue diagnostic + recovery panel. Renders every entry in the
 * local sync queue grouped by status so the user can see what's stuck,
 * inspect the request body, and either Retry or Discard each failure.
 *
 * Opening this panel acks the app-shell `SyncFailedBanner` — the ack
 * writes the current time into `syncMeta.failedBannerAcknowledgedAt`,
 * which suppresses the banner until a *new* failure lands afterwards.
 *
 * Cascade model (Phase 8-F): a failed entry can have downstream
 * `blocked` entries (anything later that referenced one of its
 * client-supplied ids). Retry on a parent unblocks the chain
 * automatically; Discard on a parent prompts with the list of
 * dependents that will also be dropped.
 */
function SyncPanel() {
  const { t, i18n } = useTranslation();
  // Scope the panel to the current user — IndexedDB is per-origin, not
  // per-user, so historic account switches leave foreign-user entries
  // sitting in the same Dexie store. Without this filter the panel
  // would render mutations the current user can't legitimately Retry
  // (the server would refuse) and could Discard mutations that would
  // succeed for the rightful owner when they next log in.
  const viewerId = useRequiredViewerId();

  const liveEntries = useLiveQuery(
    async () => {
      const all = await db.syncQueue.orderBy("createdAt").toArray();
      return filterOwnedBy(all, viewerId);
    },
    [viewerId],
  );
  const entries: SyncQueueEntry[] = liveEntries ?? [];

  // Track which entry the user is about to discard so we can confirm
  // first. Stored as the entry id; null when no dialog is open.
  const [discardingId, setDiscardingId] = useState<number | null>(null);

  // Ack the banner whenever this component is mounted. The banner reads
  // `syncMeta.failedBannerAcknowledgedAt` against the queue's max
  // `failedAt`; bumping the ack to "now" silences any prior failures
  // and lets a future failure re-arm.
  useEffect(() => {
    void setSyncMeta(SYNC_META_FAILED_BANNER_ACK, new Date().toISOString());
  }, []);

  const pending = entries.filter((e) => e.status === "pending");
  const failed = entries.filter((e) => e.status === "failed");
  const blocked = entries.filter((e) => e.status === "blocked");
  const discarded = entries.filter((e) => e.status === "discarded");

  // Group every failed parent with its transitive blocked descendants.
  // Each parent renders as a card; its dependents collapse under a
  // "Show N related changes" toggle so the user sees one root call to
  // act on rather than a 30-row wall after a cascade fails. The Retry
  // / Discard buttons live only on the parent — clicking Retry on a
  // dependent doesn't help (it just re-fails until the parent lands),
  // so we hide the affordance entirely on the children.
  const failureGroups = buildGroups(failed, blocked);
  // Blocked entries whose parent isn't currently `failed` (parent was
  // discarded or somehow vanished). Shouldn't happen under normal
  // flows — discard cascade now tombstones dependents alongside the
  // parent — but render them defensively so they can be acted on.
  const orphanBlocked = blocked.filter(
    (b) => !failureGroups.some((g) => g.dependentIds.has(b.id ?? -1)),
  );
  // Discarded entries group the same way: a root (no blockedBy — was
  // failed before discard) and dependents that point at it via
  // blockedBy (preserved through the tombstone). Retry on the root
  // un-discards the cascade back to a working state — same affordance
  // as the failed view, identical mental model.
  const discardedRoots = discarded.filter(
    (e) => e.blockedBy === undefined,
  );
  const discardedDescendants = discarded.filter(
    (e) => e.blockedBy !== undefined,
  );
  const discardedGroups = buildGroups(discardedRoots, discardedDescendants);
  // Defensive: if a discarded dependent's root somehow isn't in the
  // queue any more, render it standalone so the user can still Retry
  // it. Same orphan logic as the blocked side above.
  const orphanDiscarded = discardedDescendants.filter(
    (d) => !discardedGroups.some((g) => g.dependentIds.has(d.id ?? -1)),
  );

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "short",
  });

  const discardTarget =
    discardingId !== null
      ? entries.find((e) => e.id === discardingId) ?? null
      : null;

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

      {blocked.length > 0 && (
        <p
          className={styles.hint}
          data-testid="sync-summary-blocked"
        >
          {t("settings.sync.blocked", { count: blocked.length })}
        </p>
      )}

      {pending.length > 0 && (
        <ul className={styles.syncList} data-testid="sync-pending-list">
          {pending.map((entry) => (
            <SyncEntryRow
              key={entry.id ?? `${entry.createdAt}-${entry.url}`}
              entry={entry}
              dateFormatter={dateFormatter}
              onRetry={null}
              onRequestDiscard={null}
            />
          ))}
        </ul>
      )}

      {failureGroups.length > 0 && (
        <div className={styles.syncList} data-testid="sync-entry-list">
          {failureGroups.map((group) => (
            <FailureGroupCard
              key={group.parent.id ?? `${group.parent.createdAt}-${group.parent.url}`}
              group={group}
              dateFormatter={dateFormatter}
              onRetry={() =>
                group.parent.id !== undefined &&
                void syncEngine.retry(group.parent.id)
              }
              onRequestDiscard={() =>
                group.parent.id !== undefined &&
                setDiscardingId(group.parent.id)
              }
            />
          ))}
        </div>
      )}

      {orphanBlocked.length > 0 && (
        <ul
          className={styles.syncList}
          data-testid="sync-orphan-blocked-list"
        >
          {orphanBlocked.map((entry) => (
            <SyncEntryRow
              key={entry.id ?? `${entry.createdAt}-${entry.url}`}
              entry={entry}
              dateFormatter={dateFormatter}
              onRetry={
                entry.id !== undefined
                  ? () => void syncEngine.retry(entry.id!)
                  : null
              }
              onRequestDiscard={
                entry.id !== undefined
                  ? () => setDiscardingId(entry.id!)
                  : null
              }
            />
          ))}
        </ul>
      )}

      {discarded.length > 0 && (
        <DiscardedEntries
          totalCount={discarded.length}
          groups={discardedGroups}
          orphans={orphanDiscarded}
          dateFormatter={dateFormatter}
        />
      )}

      {discardTarget && (
        <DiscardConfirmDialog
          entry={discardTarget}
          dateFormatter={dateFormatter}
          onCancel={() => setDiscardingId(null)}
          onConfirm={async (cascade) => {
            if (discardTarget.id === undefined) return;
            await syncEngine.discard(discardTarget.id, { cascade });
            setDiscardingId(null);
          }}
        />
      )}
    </div>
  );
}

/** Collapsible bottom section listing tombstoned (discarded) queue
 * entries. The user deliberately gave up on these, but the rows stay
 * in the queue so downstream gates that scan it (`useMatchSyncStatus`
 * for the Share button) keep the corresponding match / profile flagged
 * as not-yet-synced.
 *
 * Discarded entries are rendered with the same parent-with-collapsible-
 * dependents card as the failed cascade above — same mental model, same
 * UX, and clicking Retry on a discarded root undoes the whole cascade
 * (the engine's `rediscardedCascadeToBlocked` walks `blockedBy` to
 * resurrect tombstoned dependents back to `blocked`, waiting for the
 * root to drain). */
function DiscardedEntries({
  totalCount,
  groups,
  orphans,
  dateFormatter,
}: {
  totalCount: number;
  groups: FailureGroup[];
  orphans: SyncQueueEntry[];
  dateFormatter: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div
      className={styles.syncDiscardedSection}
      data-testid="sync-discarded-section"
    >
      <button
        type="button"
        className={styles.syncDiscardedToggle}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="sync-discarded-toggle"
      >
        {t("settings.sync.discardedSection", { count: totalCount })}
        <Icon name={open ? "minus" : "plus"} size={14} />
      </button>

      {open && (
        <>
          <p className={styles.hint}>{t("settings.sync.discardedSectionHint")}</p>
          {groups.length > 0 && (
            <div className={styles.syncList} data-testid="sync-discarded-list">
              {groups.map((group) => (
                <FailureGroupCard
                  key={group.parent.id ?? `${group.parent.createdAt}-${group.parent.url}`}
                  group={group}
                  dateFormatter={dateFormatter}
                  onRetry={() =>
                    group.parent.id !== undefined &&
                    void syncEngine.retry(group.parent.id)
                  }
                  // Already discarded — no Discard affordance.
                  onRequestDiscard={null}
                />
              ))}
            </div>
          )}
          {orphans.length > 0 && (
            <ul className={styles.syncList} data-testid="sync-discarded-orphans">
              {orphans.map((entry) => (
                <SyncEntryRow
                  key={entry.id ?? `${entry.createdAt}-${entry.url}`}
                  entry={entry}
                  dateFormatter={dateFormatter}
                  onRetry={
                    entry.id !== undefined
                      ? () => void syncEngine.retry(entry.id!)
                      : null
                  }
                  onRequestDiscard={null}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SyncEntryRow({
  entry,
  dateFormatter,
  onRetry,
  onRequestDiscard,
}: {
  entry: SyncQueueEntry;
  dateFormatter: Intl.DateTimeFormat;
  onRetry: (() => void) | null;
  onRequestDiscard: (() => void) | null;
}) {
  const { t } = useTranslation();
  const [bodyOpen, setBodyOpen] = useState(false);
  const path = stripQueryString(entry.url);
  const message = entry.errorBody?.error ?? entry.error;
  const isFailed = entry.status === "failed";
  const isBlocked = entry.status === "blocked";
  const isDiscarded = entry.status === "discarded";

  return (
    <li
      className={`${styles.syncEntry} ${isFailed ? styles.syncEntryFailed : ""} ${isBlocked ? styles.syncEntryBlocked : ""} ${isDiscarded ? styles.syncEntryDiscarded : ""}`}
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
        {isBlocked && (
          <span
            className={styles.syncEntryBlockedBadge}
            data-testid="sync-entry-blocked-badge"
          >
            {t("settings.sync.blockedBadge")}
          </span>
        )}
        {isDiscarded && (
          <span
            className={styles.syncEntryBlockedBadge}
            data-testid="sync-entry-discarded-badge"
          >
            {t("settings.sync.discardedBadge")}
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

      {isBlocked && (
        <p className={styles.syncEntryMeta}>{t("settings.sync.blockedHint")}</p>
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

      <button
        type="button"
        className={styles.syncEntryBodyToggle}
        onClick={() => setBodyOpen((open) => !open)}
        data-testid="sync-entry-body-toggle"
        aria-expanded={bodyOpen}
      >
        {bodyOpen
          ? t("settings.sync.bodyToggleHide")
          : t("settings.sync.bodyToggleShow")}
      </button>

      {bodyOpen && (
        <pre
          className={styles.syncEntryBody}
          data-testid="sync-entry-body"
        >
          {prettifyBody(entry.body) ?? t("settings.sync.bodyEmpty")}
        </pre>
      )}

      {(onRetry || onRequestDiscard) && (
        <div className={styles.syncEntryActions}>
          {onRetry && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRetry}
              iconBefore={<Icon name="refresh" size={14} />}
              data-testid="sync-entry-retry"
            >
              {t("settings.sync.retry")}
            </Button>
          )}
          {onRequestDiscard && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onRequestDiscard}
              iconBefore={<Icon name="x" size={14} />}
              data-testid="sync-entry-discard"
            >
              {t("settings.sync.discard")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function DiscardConfirmDialog({
  entry,
  dateFormatter,
  onConfirm,
  onCancel,
}: {
  entry: SyncQueueEntry;
  dateFormatter: Intl.DateTimeFormat;
  onConfirm: (cascade: boolean) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [dependents, setDependents] = useState<SyncQueueEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Resolve dependents on mount so the dialog renders the count
  // before the user clicks Confirm. Stays null while loading; render
  // a placeholder body in the meantime so the dialog dimensions
  // don't jump when the count arrives.
  useEffect(() => {
    if (entry.id === undefined) {
      setDependents([]);
      return;
    }
    let cancelled = false;
    void syncEngine.dependentsOf(entry.id).then((deps) => {
      if (!cancelled) setDependents(deps);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  // Escape closes; matches MergeDialog UX so users have a consistent
  // dismiss affordance across the app.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const path = stripQueryString(entry.url);
  const cascadeCount = dependents?.length ?? 0;
  const hasCascade = cascadeCount > 0;

  return (
    <div
      className={styles.syncDiscardBackdrop}
      role="dialog"
      aria-modal="true"
      data-testid="sync-discard-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.syncDiscardSheet}>
        <h2 className={styles.syncDiscardTitle}>
          {t("settings.sync.discardConfirmTitle")}
        </h2>
        <p className={styles.syncDiscardEntry}>
          {t("settings.sync.entryLabel", { method: entry.method, path })}
        </p>
        <p className={styles.syncDiscardBody}>
          {hasCascade
            ? t("settings.sync.discardConfirmBody", { count: cascadeCount })
            : t("settings.sync.discardConfirmBodySolo")}
        </p>
        {hasCascade && dependents && (
          <ul
            className={styles.syncDiscardList}
            data-testid="sync-discard-dependent-list"
          >
            {dependents.map((dep) => (
              <li key={dep.id ?? `${dep.createdAt}-${dep.url}`}>
                {t("settings.sync.entryLabel", {
                  method: dep.method,
                  path: stripQueryString(dep.url),
                })}
                <span className={styles.syncDiscardListMeta}>
                  {" · "}
                  {dateFormatter.format(new Date(dep.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.syncDiscardActions}>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
          >
            {t("settings.sync.discardConfirmCancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="md"
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(hasCascade);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || dependents === null}
            data-testid="sync-discard-confirm"
          >
            {t("settings.sync.discardConfirmCta")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function stripQueryString(url: string): string {
  const queryAt = url.indexOf("?");
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

type FailureGroup = {
  parent: SyncQueueEntry;
  dependents: SyncQueueEntry[];
  /** Ids of every dependent in `dependents`, hoisted for O(1) lookups
   * when computing orphan-blocked entries upstream. */
  dependentIds: Set<number>;
};

/** Group each parent with its transitive descendants by walking the
 * `blockedBy` chain. Reused for both the failed-cascade view (parent
 * is `failed`, dependents are `blocked`) and the discarded-tombstone
 * view (parent + dependents are all `discarded`).
 *
 * Dependents are flattened (not nested) so the expanded view is a
 * scannable list rather than a deep tree — even when B blocks C and
 * C blocks D, the user only ever clicks Retry on A and the cascade
 * resolves. */
function buildGroups(
  parents: SyncQueueEntry[],
  candidates: SyncQueueEntry[],
): FailureGroup[] {
  return parents.map((parent) => {
    const dependents: SyncQueueEntry[] = [];
    const queue: number[] = parent.id !== undefined ? [parent.id] : [];
    const seen = new Set<number>(queue);
    while (queue.length > 0) {
      const ancestorId = queue.shift();
      if (ancestorId === undefined) continue;
      for (const candidate of candidates) {
        if (candidate.id === undefined) continue;
        if (candidate.blockedBy !== ancestorId) continue;
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        dependents.push(candidate);
        queue.push(candidate.id);
      }
    }
    return {
      parent,
      dependents,
      dependentIds: new Set(
        dependents.map((d) => d.id).filter((id): id is number => id !== undefined),
      ),
    };
  });
}

/** Render one failed parent with its blocked descendants collapsed
 * under a "Show N related changes" toggle. Retry / Discard live only
 * on the parent — clicking them on a dependent is a no-op until the
 * parent succeeds, so the UI hides the affordance there entirely. */
function FailureGroupCard({
  group,
  dateFormatter,
  onRetry,
  onRequestDiscard,
}: {
  group: FailureGroup;
  dateFormatter: Intl.DateTimeFormat;
  onRetry: () => void;
  /** Null when the card is rendered inside the Discarded section —
   * the entry is already tombstoned, so the Discard affordance is
   * suppressed and the user only sees Retry. */
  onRequestDiscard: (() => void) | null;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const dependentCount = group.dependents.length;

  return (
    <div className={styles.syncGroup} data-testid="sync-failure-group">
      <SyncEntryRow
        entry={group.parent}
        dateFormatter={dateFormatter}
        onRetry={onRetry}
        onRequestDiscard={onRequestDiscard}
      />

      {dependentCount > 0 && (
        <div className={styles.syncGroupDependents}>
          <button
            type="button"
            className={styles.syncGroupToggle}
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            data-testid="sync-group-related-toggle"
          >
            {expanded
              ? t("settings.sync.relatedToggleHide", { count: dependentCount })
              : t("settings.sync.relatedToggleShow", { count: dependentCount })}
            <Icon name={expanded ? "minus" : "plus"} size={12} />
          </button>

          {expanded && (
            <ul
              className={styles.syncList}
              data-testid="sync-group-dependents"
            >
              {group.dependents.map((dependent) => (
                <SyncEntryRow
                  key={dependent.id ?? `${dependent.createdAt}-${dependent.url}`}
                  entry={dependent}
                  dateFormatter={dateFormatter}
                  onRetry={null}
                  onRequestDiscard={null}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Pretty-print the JSON body of a queued mutation for the Sync panel.
 * Non-JSON bodies (or empty bodies) render the raw string. Returns
 * `null` for entirely missing bodies so the caller can substitute a
 * localized empty-state message. */
function prettifyBody(body: string | undefined): string | null {
  if (body === undefined || body === "") return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return body;
  }
}
