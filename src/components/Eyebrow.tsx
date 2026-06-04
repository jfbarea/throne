import React from "react";

interface EyebrowProps {
  children: React.ReactNode;
  className?: string;
  as?: "span" | "div" | "p";
}

// Eyebrow — small caps section label (12px, +160 tracking, uppercase, fg-faint)
export function Eyebrow({
  children,
  className = "",
  as: Tag = "span",
}: EyebrowProps) {
  return (
    <Tag
      className={[
        "text-[12px] leading-[16px] font-semibold uppercase tracking-[0.16em] text-[var(--fg-faint)]",
        className,
      ]
        .join(" ")
        .trim()}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {children}
    </Tag>
  );
}
