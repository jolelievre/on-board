import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import { SyncPill, type SyncState } from "../ui/SyncPill";
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
  /** Slot in the top-right of the header. Used for page-specific
   * affordances like the Skull King scoreboard toggle. The global
   * offline / sync pill is rendered by `SyncStatus` (mounted in
   * `_authenticated.tsx`), so the Header no longer auto-renders one. */
  right?: ReactNode;
};

/**
 * Global header. The right slot is page-specific. The sync/offline
 * indicator is rendered globally by `SyncStatus`, never duplicated here.
 */
export function Header({ back = false, syncState, left, right }: Props) {
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
        {right}
      </span>
    </header>
  );
}
