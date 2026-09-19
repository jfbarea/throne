// Admin > Nueva liga — blank-slate league creation.
// Server Component: suggests the admin's own player name from the most
// recently created league in circulation (spec §4.9), then hands off to the
// client form. Protected by /admin/layout.tsx's requireAdmin() guard.
//
// Multi-liga D2 (crear-duplicar-borrar), spec §2.9: this is the ONE route
// that creates a league in blank — `/admin/[slug]/liga` (lane B) is
// edit-only.
//
// Renders its own full chrome (AppHeader with no `leagueSlug` — there's no
// league yet), same convention as `/admin/page.tsx` (multi-liga B1):
// `/admin/layout.tsx` is guard-only, since AppHeader needs a league slug to
// build its nav links and a layout above `/admin/nueva` never has one.

import { Eyebrow } from "@/components/Eyebrow";
import { AppHeader } from "@/components/AppHeader";
import { suggestAdminDisplayName } from "@/server/league/lifecycle";
import { NewLeagueForm } from "./NewLeagueForm";

export default async function NuevaLigaPage() {
  const defaultAdminDisplayName = await suggestAdminDisplayName();

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader active="admin" />

      <main className="flex-1 px-4 py-6 max-w-4xl mx-auto w-full space-y-6">
        <div>
          <Eyebrow>Administración · Nueva liga</Eyebrow>
          <h1
            className="mt-2 text-[28px] font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
          >
            Crear liga
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            Liga en blanco: define su configuración y quién la administra.
            Para partir de otra liga existente, usa «Duplicar» desde el
            índice.
          </p>
        </div>

        <NewLeagueForm defaultAdminDisplayName={defaultAdminDisplayName} />
      </main>

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
