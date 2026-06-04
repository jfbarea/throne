import React from "react";

interface DividerProps {
  ornamental?: boolean; // ornamental: ✦ glyph in brass flanked by hairlines
  className?: string;
}

// Plain divider — 1px hairline in --border
// Ornamental divider — centered ✦ in brass flanked by hairlines
export function Divider({ ornamental = false, className = "" }: DividerProps) {
  if (ornamental) {
    return (
      <div
        className={[
          "flex items-center gap-4 my-10",
          "text-[var(--accent)] text-[14px]",
          className,
        ]
          .join(" ")
          .trim()}
        aria-hidden="true"
      >
        <span className="flex-1 h-px bg-[var(--border)]" />
        <span>✦</span>
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>
    );
  }

  return (
    <hr
      className={[
        "border-0 h-px bg-[var(--border)] my-8",
        className,
      ]
        .join(" ")
        .trim()}
      aria-hidden="true"
    />
  );
}
