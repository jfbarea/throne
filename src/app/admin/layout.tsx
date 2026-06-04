// Admin layout — requires ADMIN session (server-side guard).
// All routes under /admin are protected. SPEC §5.

import { requireAdmin } from "@/lib/guards";
import Link from "next/link";
import { Crown, Gear, Users, Sword, Gavel, ChartBar } from "@phosphor-icons/react/dist/ssr";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guard: redirects to /login or /unauthorized if session is absent or not ADMIN.
  await requireAdmin();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      {/* Top nav */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
        style={{
          background: "var(--bg-raised)",
          borderColor: "var(--border)",
        }}
      >
        {/* Wordmark */}
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span style={{ color: "var(--accent)" }}>✦</span>
          <span
            className="text-[20px] font-semibold leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            throne
          </span>
          <span
            className="ml-1 text-[11px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
          >
            admin
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          <Link
            href="/admin"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] no-underline"
            style={{
              fontFamily: "var(--font-sans)",
              color: "var(--fg-muted)",
            }}
          >
            <Crown size={14} />
            <span className="hidden sm:inline">Panel</span>
          </Link>
          <Link
            href="/admin/liga"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] no-underline"
            style={{
              fontFamily: "var(--font-sans)",
              color: "var(--fg-muted)",
            }}
          >
            <Gear size={14} />
            <span className="hidden sm:inline">Liga</span>
          </Link>
          <Link
            href="/admin/jugadores"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] no-underline"
            style={{
              fontFamily: "var(--font-sans)",
              color: "var(--fg-muted)",
            }}
          >
            <Users size={14} />
            <span className="hidden sm:inline">Jugadores</span>
          </Link>
          <Link
            href="/admin/emparejamientos"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] no-underline"
            style={{
              fontFamily: "var(--font-sans)",
              color: "var(--fg-muted)",
            }}
          >
            <Sword size={14} />
            <span className="hidden sm:inline">Partidas</span>
          </Link>
          <Link
            href="/admin/disputas"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] no-underline"
            style={{
              fontFamily: "var(--font-sans)",
              color: "var(--fg-muted)",
            }}
          >
            <Gavel size={14} />
            <span className="hidden sm:inline">Disputas</span>
          </Link>
          <Link
            href="/clasificacion"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-colors duration-[120ms] no-underline"
            style={{
              fontFamily: "var(--font-sans)",
              color: "var(--fg-muted)",
            }}
          >
            <ChartBar size={14} />
            <span className="hidden sm:inline">Clasificación</span>
          </Link>
        </nav>
      </header>

      {/* Page content */}
      <main className="flex-1 px-4 py-6 max-w-4xl mx-auto w-full">
        {children}
      </main>

      {/* Footer */}
      <footer
        className="px-4 py-3 text-center text-[11px] border-t"
        style={{
          color: "var(--fg-faint)",
          borderColor: "var(--border)",
          fontFamily: "var(--font-sans)",
        }}
      >
        throne · Panel de administración
      </footer>
    </div>
  );
}
