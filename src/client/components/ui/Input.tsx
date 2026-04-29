import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import styles from "./Input.module.css";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  fieldClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, id, className, fieldClassName, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputClasses = [styles.input, className].filter(Boolean).join(" ");

  if (!label) {
    return <input ref={ref} id={inputId} className={inputClasses} {...rest} />;
  }

  return (
    <div className={[styles.field, fieldClassName].filter(Boolean).join(" ")}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input ref={ref} id={inputId} className={inputClasses} {...rest} />
    </div>
  );
});
