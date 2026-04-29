import type { ReactNode } from "react";
import styles from "./Group.module.css";

type Props = {
  title: ReactNode;
  children: ReactNode;
};

export function Group({ title, children }: Props) {
  return (
    <div className={styles.group}>
      <h4 className={styles.title}>{title}</h4>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
