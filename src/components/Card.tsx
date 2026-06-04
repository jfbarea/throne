import React from "react";

interface CardProps {
  featured?: boolean; // featured: 1px brass top border instead of ink border
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({
  featured = false,
  children,
  className = "",
  onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      // a11y: interactive cards must be keyboard-reachable.
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={[
        "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] p-6",
        featured ? "border-t-[var(--accent)]" : "",
        onClick ? "cursor-pointer transition-colors duration-[120ms] hover:bg-[var(--surface-hover)]" : "",
        className,
      ]
        .join(" ")
        .trim()}
      style={
        featured
          ? { borderTopColor: "var(--accent)", borderTopWidth: "1px" }
          : undefined
      }
    >
      {children}
    </div>
  );
}

// Eyebrow label — small caps, brass-tinged metadata
export function CardEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--fg-faint)]"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </span>
  );
}

// Card title — display serif
export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mt-[6px] mb-[10px] text-[22px] leading-[1.2] font-semibold text-[var(--fg)]"
      style={{ fontFamily: "var(--font-display)" }}
    >
      {children}
    </h3>
  );
}
