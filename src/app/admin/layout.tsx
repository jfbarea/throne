// Admin layout — requires ADMIN session (server-side guard) for every route
// under /admin. SPEC §5.
//
// Multi-liga B1 (indice-de-ligas-y-pantallas-con-slug): this used to also
// render the page chrome (AppHeader + main wrapper + footer) — but AppHeader
// needs the current league's slug to build its nav links (spec §2.3, §4.10),
// and a layout above a dynamic `[slug]` segment never receives that
// segment's params, only the segment's own layout/page does. So the chrome
// moved down to wherever the slug (or its absence) is actually known:
// `/admin/page.tsx` (the league index — no slug) and
// `/admin/[slug]/layout.tsx` (every page scoped to one league). This layout
// is now guard-only, same as every player page already builds its own
// chrome inline instead of relying on a shared cross-cutting layout.
import { requireAdmin } from "@/lib/guards";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guard: redirects to /login or /unauthorized if session is absent or not ADMIN.
  await requireAdmin();

  return <>{children}</>;
}
