import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import styles from "./LinkCelebration.module.css";

/**
 * Brief "Linked!" celebration shown on both the scanner's side and the
 * shower's side the moment a bilateral profile link lands. Pure
 * presentation — the parent decides when it mounts and when to swap
 * in the post-link UI (the linked card).
 *
 * The component auto-fires `onDone` after `durationMs`, so the parent
 * can collapse the celebration into the next view without timing
 * coordination.
 */
export function LinkCelebration({
  durationMs = 1400,
  onDone,
}: {
  durationMs?: number;
  onDone?: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!onDone) return;
    const id = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(id);
  }, [durationMs, onDone]);

  return (
    <div className={styles.root} data-testid="link-celebration">
      <span className={styles.iconRing}>
        <Icon name="sparkle" size={32} />
      </span>
      <p className={styles.title}>{t("link.celebration.title")}</p>
      <p className={styles.subtitle}>{t("link.celebration.subtitle")}</p>
    </div>
  );
}
