import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { db } from "../../lib/db";
import { Icon } from "../ui/Icon";

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

  const needsBanner = useLiveQuery(
    async () => {
      const failed = await db.syncQueue
        .where("status")
        .equals("failed")
        .toArray();
      if (failed.length === 0) return false;

      // The queue's most recent failure timestamp drives the ack
      // comparison. Entries that predate Phase 8-E don't carry a
      // `failedAt` — surface them anyway (treat as "needs ack").
      const latestFailedAt = failed.reduce<string | null>((acc, entry) => {
        if (!entry.failedAt) return acc;
        if (acc === null || entry.failedAt > acc) return entry.failedAt;
        return acc;
      }, null);

      const ack = await db.syncMeta.get("failedBannerAcknowledgedAt");
      if (latestFailedAt === null) return true;
      if (!ack) return true;
      return ack.value < latestFailedAt;
    },
    [],
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
