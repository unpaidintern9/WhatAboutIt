import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", icon, children, className = "", ...props },
  ref
) {
  return (
    <button ref={ref} className={`wai-button wai-button-${variant} ${className}`.trim()} {...props}>
      {icon}
      {children}
    </button>
  );
});
