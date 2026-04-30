import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";

export function OfflineBanner() {
  const { t } = useTranslation();
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
