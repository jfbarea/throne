// Admin > Jugadores — player management page.
// Server Component: loads the league (scoped by the URL slug) and its
// players from DB. Protected by the /admin and /admin/[slug] layouts.
//
// Multi-liga B1 (indice-de-ligas-y-pantallas-con-slug): moved from the old
// single-league /admin/jugadores (`prisma.league.findFirst`). The league
// always exists here (the `[slug]` layout already resolved and guarded it),
// so the old "no hay ninguna liga creada" empty state is gone with it.

import { prisma } from "@/lib/db";
import { Eyebrow } from "@/components/Eyebrow";
import { PlayersPageClient } from "./PlayersPageClient";

export default async function AdminJugadoresPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Never null: the `/admin/[slug]` layout already resolved and guarded this
  // exact slug (spec §4.1). Queried directly (not via the cache()-wrapped
  // `resolveLeagueBySlug`) because this page needs the players included,
  // which that shared helper doesn't select.
  const league = (await prisma.league.findUnique({
    where: { slug },
    include: {
      players: {
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          displayName: true,
          faction: true,
          role: true,
          active: true,
        },
      },
    },
  }))!;

  const players = league.players.map((p) => ({
    ...p,
    role: p.role as "ADMIN" | "PLAYER",
  }));

  const activeCount = players.filter((p) => p.active).length;

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Administración · Jugadores</Eyebrow>
        <h1
          className="mt-2 text-[28px] font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Gestión de jugadores
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {league.name} · {league.season} ·{" "}
          <span style={{ color: "var(--accent)" }}>
            {activeCount} activo{activeCount !== 1 ? "s" : ""}
          </span>{" "}
          / {players.length} total
        </p>
      </div>

      <PlayersPageClient leagueId={league.id} players={players} />
    </div>
  );
}
