import React from "react";

type BadgeVariant = "neutral" | "brass" | "ember" | "moss" | "ash";

interface BadgeProps {
  variant?: BadgeVariant;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

// Pill/badge — always 999px radius (the only round element in the system)
const variantStyles: Record<BadgeVariant, string> = {
  neutral: "bg-[var(--ink-600)] text-[var(--paper-100)] border-[var(--ink-500)]",
  brass:   "bg-[rgba(201,166,107,0.12)] text-[var(--accent)] border-[rgba(201,166,107,0.3)]",
  ember:   "bg-[var(--ember-100)] text-[var(--ember-500)] border-[rgba(184,92,60,0.4)]",
  moss:    "bg-[var(--moss-100)] text-[var(--moss-500)] border-[rgba(107,122,78,0.4)]",
  ash:     "bg-[var(--ash-100)] text-[var(--ash-500)] border-[rgba(122,139,153,0.4)]",
};

const dotColors: Record<BadgeVariant, string> = {
  neutral: "var(--paper-200)",
  brass:   "var(--brass-500)",
  ember:   "var(--ember-500)",
  moss:    "var(--moss-500)",
  ash:     "var(--ash-500)",
};

export function Badge({
  variant = "neutral",
  dot = false,
  children,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-[6px] px-[10px] py-1",
        "rounded-[999px] border text-[12px] font-semibold leading-none tracking-[0.02em]",
        variantStyles[variant],
        className,
      ]
        .join(" ")
        .trim()}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {dot && (
        <span
          className="w-[6px] h-[6px] rounded-full shrink-0"
          style={{ background: dotColors[variant] }}
        />
      )}
      {children}
    </span>
  );
}

// StatusBadge — semantic convenience wrapper
type MatchStatus = "pendiente" | "confirmado" | "disputado" | "programado" | "info";

const statusMap: Record<MatchStatus, { variant: BadgeVariant; label: string }> = {
  pendiente:  { variant: "neutral", label: "Pendiente" },
  confirmado: { variant: "moss",    label: "Confirmado" },
  disputado:  { variant: "ember",   label: "Disputado" },
  programado: { variant: "brass",   label: "Programado" },
  info:       { variant: "ash",     label: "Info" },
};

interface StatusBadgeProps {
  status: MatchStatus;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const { variant, label } = statusMap[status];
  return (
    <Badge variant={variant} dot className={className}>
      {label}
    </Badge>
  );
}
