import type { HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon";
import styles from "./SyncPill.module.css";

export type SyncState = "idle" | "saving" | "saved" | "offline" | "error";

type Props = HTMLAttributes<HTMLSpanElement> & {
  state: SyncState;
  /** Optional label override; otherwise translation keys under `matches.*` apply. */
  label?: string;
};

export function SyncPill({ state, label, className, ...rest }: Props) {
  const { t } = useTranslation();

  const config: Record<
    SyncState,
    { iconName: Parameters<typeof Icon>[0]["name"] | null; defaultLabel: string }
  > = {
    idle: { iconName: "wifi", defaultLabel: "" },
    saving: { iconName: "sync", defaultLabel: t("matches.saving") },
    saved: { iconName: "check", defaultLabel: t("matches.saved") },
    offline: { iconName: "wifi-off", defaultLabel: t("matches.offline", { defaultValue: "Offline" }) },
    error: { iconName: "x", defaultLabel: t("matches.saveError") },
  };

  const { iconName, defaultLabel } = config[state];
  const text = label ?? defaultLabel;
  const showLabel = state !== "idle";

  const classes = [styles.pill, styles[state], className].filter(Boolean).join(" ");

  return (
    <span className={classes} {...rest}>
      {iconName && <Icon name={iconName} size={14} />}
      {showLabel && text && <span>{text}</span>}
    </span>
  );
}
