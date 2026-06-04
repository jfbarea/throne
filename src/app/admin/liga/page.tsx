// Admin > Liga — league configuration page.
// Server Component: loads existing league (if any) and renders LeagueForm.
// Protected by AdminLayout.

import { prisma } from "@/lib/db";
import { Eyebrow } from "@/components/Eyebrow";
import { LeagueFormWrapper } from "./LeagueFormWrapper";

export default async function AdminLigaPage() {
  // In MVP there is a single active league. We load the most recent one.
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Administración · Liga</Eyebrow>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          {league ? "Configuración de la liga" : "Crear liga"}
        </h1>
        {league && (
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            {league.name} · {league.season}
          </p>
        )}
      </div>

      {/* Client wrapper handles post-save redirect/toast */}
      <LeagueFormWrapper league={league ?? undefined} />
    </div>
  );
}
