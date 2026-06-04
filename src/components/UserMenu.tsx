"use client";

// UserMenu — appbar button showing the current identity with a logout action.
// Receives the resolved label/role from the server (AppHeaderUser); never trusts
// client-provided identity. Closes on outside-click or Escape.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserCircle, SignOut, CaretDown } from "@phosphor-icons/react";

type Role = "ADMIN" | "PLAYER";

export function UserMenu({ label, role }: { label: string; role: Role }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside-click or Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const roleLabel = role === "ADMIN" ? "Administrador" : "Jugador";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de usuario"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms]"
        style={{
          fontFamily: "var(--font-sans)",
          color: "var(--fg-muted)",
          background: open ? "var(--bg)" : "transparent",
          border: "1px solid var(--border)",
          cursor: "pointer",
          maxWidth: 200,
        }}
      >
        <UserCircle size={16} />
        <span className="hidden sm:inline truncate" style={{ maxWidth: 120 }}>
          {label}
        </span>
        <CaretDown size={12} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 rounded-[var(--radius-sm)] overflow-hidden"
          style={{
            minWidth: 220,
            background: "var(--bg-raised)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-2, 0 4px 16px rgba(0,0,0,0.4))",
            zIndex: 50,
          }}
        >
          {/* Identity block */}
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="text-[10px] uppercase tracking-[0.14em] mb-1"
              style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
            >
              Conectado como
            </div>
            <div
              className="text-[15px] font-semibold leading-tight truncate"
              style={{ color: "var(--fg)", fontFamily: "var(--font-display)" }}
            >
              {label}
            </div>
            <div
              className="text-[11px] mt-0.5"
              style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
            >
              {roleLabel}
            </div>
          </div>

          {/* Logout */}
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={loading}
            className="w-full flex items-center gap-2 px-4 py-3 text-[13px] font-semibold transition-colors duration-[120ms]"
            style={{
              fontFamily: "var(--font-sans)",
              color: "var(--danger, #B85C3C)",
              background: "transparent",
              border: "none",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            <SignOut size={16} />
            {loading ? "Saliendo…" : "Cerrar sesión"}
          </button>
        </div>
      )}
    </div>
  );
}
