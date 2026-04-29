import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../ui/Icon";
import styles from "./BottomNav.module.css";

type Tab = {
  id: string;
  to: string;
  iconName: IconName;
  labelKey: string;
  defaultLabel: string;
  /** Path prefix that activates this tab. */
  match: (pathname: string) => boolean;
};

const TABS: Tab[] = [
  {
    id: "games",
    to: "/games",
    iconName: "home",
    labelKey: "nav.games",
    defaultLabel: "Games",
    match: (p) => p === "/games" || p.startsWith("/games/") || p.startsWith("/matches/"),
  },
  {
    id: "settings",
    to: "/settings",
    iconName: "cog",
    labelKey: "nav.settings",
    defaultLabel: "Settings",
    match: (p) => p === "/settings",
  },
];

export function BottomNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className={styles.nav} aria-label="Primary">
      {TABS.map((tab) => {
        const isActive = tab.match(pathname);
        return (
          <Link
            key={tab.id}
            to={tab.to}
            className={`${styles.tab} ${isActive ? styles.active : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon name={tab.iconName} size={22} />
            <span>{t(tab.labelKey, { defaultValue: tab.defaultLabel })}</span>
          </Link>
        );
      })}
    </nav>
  );
}
