// Admin layout — requires ADMIN session (server-side guard).
// All routes under /admin are protected. SPEC §5.

import { requireAdmin } from "@/lib/guards";
import { AppHeader } from "@/components/AppHeader";

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
      <AppHeader active="admin" />

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
