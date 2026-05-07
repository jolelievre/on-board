import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Icon } from "../ui/Icon";

/**
 * Surfaces a "New version available" banner when the service worker
 * detects a new build. The user explicitly accepts the update — at which
 * point the new SW activates and the page reloads. The new precache is
 * already populated by the time this banner becomes interactive (Workbox
 * waits for the install step to complete), so going offline immediately
 * after the reload finds the new shell + assets cached.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
  });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        background: "var(--color-info-bg, #dbeafe)",
        color: "var(--color-info-fg, #1e3a8a)",
        fontSize: "0.8125rem",
        fontFamily: "var(--font-ui)",
        borderBottom: "1px solid var(--color-info-border, #bfdbfe)",
      }}
    >
      <Icon name="sync" size={14} />
      <span style={{ flex: 1 }}>
        {t("common.updateAvailable", { defaultValue: "New version available" })}
      </span>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        data-testid="update-banner-reload"
        style={{
          background: "transparent",
          border: "1px solid currentColor",
          color: "inherit",
          fontFamily: "inherit",
          fontWeight: 600,
          fontSize: "0.8125rem",
          padding: "4px 12px",
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        {t("common.updateReload", { defaultValue: "Reload" })}
      </button>
    </div>
  );
}
