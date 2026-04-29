import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";

type Props = HTMLAttributes<HTMLDivElement> & {
  flush?: boolean;
  alt?: boolean;
  children: ReactNode;
};

export function Card({
  flush = false,
  alt = false,
  className,
  children,
  ...rest
}: Props) {
  const classes = [
    styles.surface,
    flush && styles.flush,
    alt && styles.alt,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
