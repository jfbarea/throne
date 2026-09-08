"use client";

// AdminMenu — dropdown in the appbar holding the admin-only sections.
// Rendered only for ADMIN sessions (the parent AppHeader decides). Opens on
// click, closes on outside click or Escape.

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import {
  Crown,
  CaretDown,
  Gear,
  Users,
  Sword,
  Trophy,
  CalendarBlank,
} from "@phosphor-icons/react";

const ADMIN_LINKS = [
  { href: "/admin", label: "Panel", Icon: Crown },
  { href: "/admin/liga", label: "Liga", Icon: Gear },
  { href: "/admin/jugadores", label: "Jugadores", Icon: Users },
  { href: "/admin/emparejamientos", label: "Emparejamientos", Icon: Sword },
  { href: "/admin/rondas", label: "Rondas", Icon: CalendarBlank },
  { href: "/admin/playoffs", label: "Playoffs", Icon: Trophy },
];

export function AdminMenu({ active = false }: { active?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] cursor-pointer"
        style={{
          fontFamily: "var(--font-sans)",
          color: active || open ? "var(--accent)" : "var(--fg-muted)",
          background: "transparent",
          border: "none",
        }}
      >
        <Crown size={14} />
        <span className="hidden sm:inline">Admin</span>
        <CaretDown
          size={12}
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 120ms",
          }}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 py-1 rounded min-w-[190px] z-20"
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {ADMIN_LINKS.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold no-underline"
              style={{ fontFamily: "var(--font-sans)", color: "var(--fg-muted)" }}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
