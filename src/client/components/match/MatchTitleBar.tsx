import type { ReactNode } from "react";
import { SketchUnderline } from "../ui/SketchUnderline";
import styles from "./MatchTitleBar.module.css";

type Props = {
  title: ReactNode;
  /** Right-side slot (e.g. SyncPill). */
  right?: ReactNode;
  /** Underline width in pixels. Defaults to ~120 for a typical title. */
  underlineWidth?: number;
};

export function MatchTitleBar({ title, right, underlineWidth = 130 }: Props) {
  return (
    <div className={styles.bar}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.underline}>
          <SketchUnderline
            width={underlineWidth}
            color="var(--color-accent)"
            seed={3}
            strokeWidth={2.5}
          />
        </div>
      </div>
      {right}
    </div>
  );
}
