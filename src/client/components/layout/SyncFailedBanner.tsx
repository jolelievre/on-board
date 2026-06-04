import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { db } from "../../lib/db";
import { Icon } from "../ui/Icon";
import { filterOwnedBy } from "../../lib/sync-ownership";
import { useRequiredViewerId } from "../../hooks/useRequiredViewerId";

/**
 * Sticky app-shell banner that surfaces a non-empty terminally-failed
 * sync queue (Phase 8-E). Stays visible until the user opens Settings,
 * which writes `syncMeta.failedBannerAcknowledgedAt` to "now"; if a new
 * failure lands afterwards its `failedAt` outruns the ack and the
 * banner re-arms.
 *
 * Rendered next to `OfflineBanner` in the authenticated layout — the
 * two states (offline / failed) are independent: a queued mutation
 * that 4xx-failed while the user was online still needs surfacing
 * even if the device has since gone offline.
 */
export function SyncFailedBanner() {
  const { t } = useTranslation();
  // Banner is scoped to the current user (8-F multi-user safety). A
  // foreign-user's failed entry lingering in this device's IndexedDB
  // would otherwise light the banner while the Sync panel — also
  // ownership-filtered — showed nothing to act on.
  const viewerId = useRequiredViewerId();

  const needsBanner = useLiveQuery(
    async () => {
      const failed = await db.syncQueue
        .where("status")
        .equals("failed")
        .toArray();
      const ownedFailed = await filterOwnedBy(failed, viewerId);
      if (ownedFailed.length === 0) return false;

      const ack = await db.syncMeta.get("failedBannerAcknowledgedAt");
      // Never opened Settings → surface anything that's failed, including
      // legacy entries from before Phase 8-E that lack `failedAt`.
      if (!ack) return true;

      // After ack: re-arm only on a *new* failure (one whose `failedAt`
      // is strictly later than the ack). Legacy entries without
      // `failedAt` count as acknowledged once Settings was opened —
      // otherwise the user would have no way to dismiss the banner for
      // entries that pre-date the failedAt instrumentation.
      const newer = ownedFailed.filter(
        (entry) =>
          entry.failedAt !== undefined && entry.failedAt > ack.value,
      );
      return newer.length > 0;
    },
    [viewerId],
    false,
  );

  if (!needsBanner) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="sync-failed-banner"
      style={{
        position: "relative",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        background: "var(--color-warning-bg, #fef3c7)",
        color: "var(--color-warning-fg, #92400e)",
        fontSize: "0.8125rem",
        fontFamily: "var(--font-ui)",
        borderBottom: "1px solid var(--color-warning-border, #fde68a)",
      }}
    >
      <Icon name="info" size={14} />
      <span style={{ flex: 1 }}>{t("common.syncFailedBanner")}</span>
      <Link
        to="/settings"
        data-testid="sync-failed-banner-cta"
        style={{
          fontWeight: 600,
          color: "inherit",
          textDecoration: "underline",
        }}
      >
        {t("common.syncFailedBannerCta")}
      </Link>
    </div>
  );
}
