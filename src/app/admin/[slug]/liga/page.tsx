// Admin > Liga — league configuration page.
// Server Component: loads the league scoped by the URL slug and renders
// LeagueForm. Protected by the /admin and /admin/[slug] layouts
// (requireAdmin + requireLeagueAccess already ran before this ever renders).
//
// Multi-liga B1 (indice-de-ligas-y-pantallas-con-slug): moved from the old
// single-league /admin/liga, which resolved the league with
// `prisma.league.findFirst({ orderBy: { createdAt: "desc" } })` and doubled
// as the creation screen. Neither survives here: the league always exists
// (the `[slug]` layout already redirected/errored otherwise — spec §4.1,
// §5.1), and creation moves to `/admin/nueva` (lane D, spec §2.9) — this
// page is edit-only.

import { resolveLeagueBySlug } from "@/lib/league-context";
import { Eyebrow } from "@/components/Eyebrow";
import { LeagueFormWrapper } from "./LeagueFormWrapper";
import { ResetLeagueButton } from "./ResetLeagueButton";

export default async function AdminLigaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Never null here: the `/admin/[slug]` layout already resolved and
  // guarded this exact slug before rendering this page body (spec §4.1).
  // `resolveLeagueBySlug` is wrapped in React's `cache()` (C1), so this is
  // not a second database round trip within the same request.
  const league = (await resolveLeagueBySlug(slug))!;

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Administración · Liga</Eyebrow>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Configuración de la liga
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {league.name} · {league.season}
        </p>
      </div>

      {/* Client wrapper handles post-save redirect/refresh */}
      <LeagueFormWrapper league={league} />

      {/* Danger zone */}
      <div className="pt-2">
        <Eyebrow>Zona de peligro</Eyebrow>
        <div className="mt-3">
          <ResetLeagueButton leagueId={league.id} />
        </div>
      </div>
    </div>
  );
}
