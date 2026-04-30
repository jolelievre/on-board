import type { HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon";
import styles from "./SyncPill.module.css";

export type SyncState = "idle" | "saving" | "saved" | "offline" | "error";

/** Save-mutation status emitted by features (e.g. score grid). Maps to a
 * SyncState for display via `saveStatusToSyncState`. Kept here so the
 * mapping lives next to the visual states. */
export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

export function saveStatusToSyncState(status: SaveStatus): SyncState {
  switch (status) {
    case "idle":
      return "idle";
    case "saving":
      return "saving";
    case "saved":
      return "saved";
    case "offline":
      return "offline";
    case "error":
      return "error";
  }
}

type Props = HTMLAttributes<HTMLSpanElement> & {
  state: SyncState;
  /** "md" (default, ~14px icon) or "lg" (~22px icon, used in the page Header). */
  size?: "md" | "lg";
  /** Optional label override; otherwise translation keys under `matches.*` apply. */
  label?: string;
};

export function SyncPill({
  state,
  size = "md",
  label,
  className,
  ...rest
}: Props) {
  const { t } = useTranslation();

  const config: Record<
    SyncState,
    { iconName: Parameters<typeof Icon>[0]["name"] | null; defaultLabel: string }
  > = {
    idle: { iconName: "wifi", defaultLabel: "" },
    saving: { iconName: "sync", defaultLabel: t("matches.saving") },
    saved: { iconName: "check", defaultLabel: t("matches.saved") },
    offline: {
      iconName: "wifi-off",
      defaultLabel: t("matches.offline", { defaultValue: "Offline" }),
    },
    error: { iconName: "x", defaultLabel: t("matches.saveError") },
  };

  const { iconName, defaultLabel } = config[state];
  const text = label ?? defaultLabel;
  const showLabel = state !== "idle";
  const iconSize = size === "lg" ? 22 : 14;

  const classes = [
    styles.pill,
    styles[state],
    size === "lg" && styles.lg,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...rest}>
      {iconName && <Icon name={iconName} size={iconSize} />}
      {showLabel && text && <span>{text}</span>}
    </span>
  );
}
