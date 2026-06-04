import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
  /** Mark the field as invalid (red border) without rendering a message. */
  invalid?: boolean;
  leadingIcon?: React.ReactNode;
}

export function Input({
  label,
  helper,
  error,
  invalid,
  leadingIcon,
  className = "",
  id,
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  const showErrorBorder = Boolean(error) || Boolean(invalid);

  return (
    <div className="flex flex-col gap-[6px]">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-faint)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {label}
        </label>
      )}

      {/* Input wrapper — matches design: bg-raised, 1px border, 2px radius */}
      <div
        className={[
          "flex items-center gap-2 px-3 py-[10px]",
          "bg-[var(--bg-raised)] border border-[var(--border)] rounded-[var(--radius-sm)]",
          "transition-all duration-[120ms]",
          "focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_2px_rgba(201,166,107,0.2)]",
          showErrorBorder
            ? "border-[var(--danger)] focus-within:border-[var(--danger)] focus-within:shadow-[0_0_0_2px_rgba(184,92,60,0.2)]"
            : "",
          className,
        ]
          .join(" ")
          .trim()}
      >
        {leadingIcon && (
          <span className="flex items-center text-[var(--fg-faint)] text-[var(--icon-sm)] shrink-0">
            {leadingIcon}
          </span>
        )}
        <input
          id={inputId}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-faint)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: "var(--font-sans)" }}
          {...props}
        />
      </div>

      {/* Helper / error text */}
      {(helper || error) && (
        <span
          className={`text-[11px] leading-[16px] ${
            error ? "text-[var(--danger)]" : "text-[var(--fg-faint)]"
          }`}
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {error ?? helper}
        </span>
      )}
    </div>
  );
}
