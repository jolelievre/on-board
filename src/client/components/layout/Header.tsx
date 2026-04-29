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
  right?: ReactNode;
};

export function Header({ back = false, syncState, right }: Props) {
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
