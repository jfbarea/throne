import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
}

// Variant styles — ink/paper/brass palette, square 2px corners
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--ink-900)] border-[var(--accent)] hover:bg-[var(--accent-hover)] hover:border-[var(--accent-hover)] active:bg-[var(--accent-press)] active:border-[var(--accent-press)] active:scale-[0.98]",
  secondary:
    "bg-[var(--surface)] text-[var(--fg)] border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] active:scale-[0.98]",
  ghost:
    "bg-transparent text-[var(--fg-muted)] border-transparent hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] active:scale-[0.98]",
  danger:
    "bg-transparent text-[var(--danger)] border-[var(--danger)] hover:bg-[var(--ember-100)] active:scale-[0.98]",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-[7px] text-[13px] gap-[6px]",
  md: "px-[18px] py-[11px] text-[14px] gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  fullWidth = false,
  icon,
  iconPosition = "left",
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center font-semibold leading-none border cursor-pointer select-none transition-all duration-[120ms] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 disabled:opacity-40 disabled:pointer-events-none";

  const rounded = "rounded-[var(--radius-sm)]";
  const width = fullWidth ? "w-full" : "";

  return (
    <button
      className={`${base} ${rounded} ${variantStyles[variant]} ${sizeStyles[size]} ${width} ${className}`}
      disabled={disabled}
      style={{ fontFamily: "var(--font-sans)" }}
      {...props}
    >
      {icon && iconPosition === "left" && (
        <span className="flex items-center text-[var(--icon-md)]">{icon}</span>
      )}
      {children}
      {icon && iconPosition === "right" && (
        <span className="flex items-center text-[var(--icon-md)]">{icon}</span>
      )}
    </button>
  );
}
