import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import styles from "./Button.module.css";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "destructive"
  | "icon";

type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "primary",
    size = "md",
    fullWidth = false,
    iconBefore,
    iconAfter,
    className,
    children,
    type,
    ...rest
  },
  ref,
) {
  const classes = [
    styles.base,
    styles[variant],
    size === "sm" && styles.sm,
    size === "lg" && styles.lg,
    fullWidth && styles.full,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      {...rest}
    >
      {iconBefore}
      {children}
      {iconAfter}
    </button>
  );
});
