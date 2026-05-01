import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import { SyncPill, type SyncState } from "../ui/SyncPill";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import styles from "./Header.module.css";

type BackProp =
  | false
  | {
      to: string;
      params?: Record<string, string>;
      label: string;
    };

type Props = {
  back?: BackProp;
  syncState?: SyncState;
  /** Slot rendered immediately after the back button (or in its place
   * when there's no back link). Use for the brand logo on the home
   * screen. */
  left?: ReactNode;
  /** When set, replaces the default offline indicator on the right side.
   * Pages that show their own SyncPill (e.g. the match page) pass it here. */
  right?: ReactNode;
};

/**
 * Global header.
 *
 * The right side auto-renders a small offline SyncPill whenever the app is
 * offline and the caller hasn't supplied a `right` slot — that gives every
 * authenticated screen a persistent offline cue once the loud OfflineBanner
 * has self-dismissed.
 */
export function Header({ back = false, syncState, left, right }: Props) {
  const { isOnline } = useOnlineStatus();

  const rightContent =
    right ?? (!isOnline ? <SyncPill state="offline" /> : null);

  return (
    <header className={styles.header}>
      {back ? (
        <Link
          to={back.to}
          params={back.params}
          className={styles.back}
          aria-label={back.label}
        >
          <Icon name="arrow-left" size={18} />
          <span>{back.label}</span>
        </Link>
      ) : left ? (
        <span className={styles.leftSlot}>{left}</span>
      ) : (
        <span style={{ width: 4 }} aria-hidden />
      )}
      <span className={styles.spacer} />
      <span className={styles.right}>
        {syncState && <SyncPill state={syncState} />}
        {rightContent}
      </span>
    </header>
  );
}
