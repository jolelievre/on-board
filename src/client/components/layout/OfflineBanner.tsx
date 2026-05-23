import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";

const BANNER_DURATION_MS = 5000;
/** Duration of the slide-out animation. Must be long enough that any
 * in-flight tap finishes hit-testing against the still-visible banner
 * (real-world taps are well under 100 ms; 280 ms gives a wide margin). */
const COLLAPSE_MS = 280;

/**
 * Loud, one-shot offline notice. Auto-dismisses after 5 s — afterwards
 * the persistent indicator is the SyncPill in the global Header.
 *
 * The dismiss is animated (max-height → 0 over 280 ms) rather than an
 * abrupt unmount: an earlier version called `return null` which removed
 * the banner from flow instantly, shifting everything below it up by
 * ~36 px in one frame. On Mobile Chrome that shift could land right
 * under the user's finger between tap-start and tap-end, retargeting
 * the click to a different element. The animated collapse keeps the
 * layout change gradual enough that a tap can't slide past its target.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(false), BANNER_DURATION_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
      data-testid="offline-banner"
      style={{
        // Stack above the global SyncStatus pill (z-index 50) — without
        // a position context, z-index has no effect, so the static
        // banner would render behind the fixed pill at the top-right.
        position: "relative",
        zIndex: 60,
        overflow: "hidden",
        // Generous max-height so the natural content (icon + one line
        // of text + padding) fits without clipping while still giving
        // the transition a target value to interpolate from.
        maxHeight: visible ? 64 : 0,
        opacity: visible ? 1 : 0,
        transition: `max-height ${COLLAPSE_MS}ms ease, opacity ${Math.round(COLLAPSE_MS * 0.7)}ms ease`,
      }}
    >
      <div
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
    </div>
  );
}
