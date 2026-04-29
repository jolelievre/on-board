import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Pill.module.css";

type Tone = "muted" | "primary" | "accent" | "success" | "warning" | "danger";

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  children: ReactNode;
};

export function Pill({ tone = "muted", className, children, ...rest }: Props) {
  const classes = [styles.pill, styles[tone], className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
