import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";

const BANNER_DURATION_MS = 5000;

/**
 * Loud, one-shot offline notice. Auto-dismisses after 5s — afterwards the
 * persistent indicator is the SyncPill in the global Header.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(false), BANNER_DURATION_MS);
    return () => window.clearTimeout(id);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 16px",
        background: "var(--color-warning-bg, #fef3c7)",
        color: "var(--color-warning-fg, #92400e)",
        fontSize: "0.8125rem",
        fontFamily: "var(--font-ui)",
        borderBottom: "1px solid var(--color-warning-border, #fde68a)",
      }}
    >
      <Icon name="wifi-off" size={14} />
      <span>{t("common.offlineBanner")}</span>
    </div>
  );
}
