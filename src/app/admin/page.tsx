// Admin dashboard — league index.
// Server Component: reads DB to list every league, split into circulación
// and archivadas, each with its own counters.
//
// Multi-liga B1 (indice-de-ligas-y-pantallas-con-slug, spec §2.3, §4.5):
// `/admin` stops being a panel for "the" single league (there is no such
// thing anymore) and becomes the index every admin action starts from. Two
// things this replaces:
//   - The quick-actions block that used to jump straight into
//     liga/jugadores/emparejamientos: those routes now require a league in
//     the URL (spec §2.3), so there's no single destination to jump to
//     until the admin picks one from the list below.
//   - `prisma.player.count({ where: { active: true } })` as a single global
//     number (`admin/page.tsx:29` pre-multi-liga) — meaningless with more
//     than one league. Every counter here is scoped with its own league's
//     `players` relation (spec §4.5, criterio 4).
//
// Renders its own full chrome (AppHeader, no `leagueSlug` — there's no
// single league this index belongs to) instead of relying on
// `/admin/layout.tsx`, which is guard-only now — see that file's comment
// for why.
import { prisma } from "@/lib/db";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Eyebrow } from "@/components/Eyebrow";
import { AppHeader } from "@/components/AppHeader";
import Link from "next/link";
import type { LeagueActionTarget } from "@/components/admin/league-actions-contract";
import { Crown, Plus } from "@phosphor-icons/react/dist/ssr";

const STATUS_LABEL: Record<string, { label: string; variant: "brass" | "moss" | "ash" | "ember" | "neutral" }> = {
  SETUP:    { label: "Configuración", variant: "brass" },
  LEAGUE:   { label: "Fase de liga",  variant: "moss"  },
  PLAYOFFS: { label: "Playoffs",      variant: "ember" },
  FINISHED: { label: "Finalizada",    variant: "neutral" },
};

export default async function AdminPage() {
  const leagues = await prisma.league.findMany({
    orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }],
    include: {
      // Two independent counts per league (spec §4.5, §2.10): active
      // players for the card's headline number, total matches to decide
      // hard-delete eligibility (LeagueActionTarget.matchCount, D2).
      _count: {
        select: {
          players: { where: { active: true } },
          matches: true,
        },
      },
    },
  });

  const targets: LeagueActionTarget[] = leagues.map((l) => ({
    id: l.id,
    slug: l.slug,
    name: l.name,
    season: l.season,
    status: l.status,
    archivedAt: l.archivedAt,
    activePlayerCount: l._count.players,
    matchCount: l._count.matches,
  }));

  const enCirculacion = targets.filter((l) => l.archivedAt === null);
  const archivadas = targets.filter((l) => l.archivedAt !== null);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader active="admin" />

      <main className="flex-1 px-4 py-6 max-w-4xl mx-auto w-full space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow>Panel de administración</Eyebrow>
            <h1
              className="mt-2 text-[32px] font-semibold leading-tight"
              style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
            >
              throne
            </h1>
            <p
              className="mt-1 text-[14px]"
              style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
            >
              Elige una liga para administrarla
            </p>
          </div>
          <Link href="/admin/nueva" className="no-underline flex-shrink-0">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-[13px] font-semibold"
              style={{
                fontFamily: "var(--font-sans)",
                background: "var(--accent)",
                color: "var(--bg)",
              }}
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Nueva liga</span>
            </span>
          </Link>
        </div>

        {targets.length === 0 && (
          <Card className="text-center py-10">
            <p
              className="text-[15px] font-semibold"
              style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
            >
              No hay ligas creadas todavía
            </p>
            <p
              className="mt-1 text-[13px]"
              style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
            >
              <Link href="/admin/nueva" style={{ color: "var(--accent)" }}>
                Crea la primera
              </Link>{" "}
              para empezar.
            </p>
          </Card>
        )}

        {enCirculacion.length > 0 && (
          <div>
            <Eyebrow>En circulación</Eyebrow>
            <div className="mt-3 space-y-2">
              {enCirculacion.map((league) => (
                <LeagueRow key={league.id} league={league} />
              ))}
            </div>
          </div>
        )}

        {archivadas.length > 0 && (
          <div>
            <Eyebrow>Archivadas</Eyebrow>
            <div className="mt-3 space-y-2">
              {archivadas.map((league) => (
                <LeagueRow key={league.id} league={league} />
              ))}
            </div>
          </div>
        )}
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

function LeagueRow({ league }: { league: LeagueActionTarget }) {
  const st = STATUS_LABEL[league.status] ?? { label: league.status, variant: "neutral" as const };
  return (
    <Card className="flex items-center justify-between gap-4 py-4">
      <Link href={`/admin/${league.slug}/liga`} className="min-w-0 flex-1 no-underline">
        <div className="flex items-center gap-2">
          <Crown size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <p
            className="text-[14px] font-semibold truncate"
            style={{ fontFamily: "var(--font-sans)", color: "var(--fg)" }}
          >
            {league.name}
          </p>
        </div>
        <p
          className="mt-0.5 text-[12px] truncate"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          {league.season} · {league.activePlayerCount} jugador
          {league.activePlayerCount !== 1 ? "es" : ""} activo
          {league.activePlayerCount !== 1 ? "s" : ""}
        </p>
      </Link>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge variant={st.variant}>{st.label}</Badge>
        {league.archivedAt !== null && <Badge variant="ash">Archivada</Badge>}
        <LeagueRowActions league={league} />
      </div>
    </Card>
  );
}

// Extension point for lane D's action components (archive, unarchive,
// duplicate, hard-delete — spec §2.8, §2.9, §2.10), built against the
// contract in src/components/admin/league-actions-contract.ts (fixed in
// C2). Until D lands, this renders nothing: no button, no gap in the
// layout, no import of a module that doesn't exist yet. Replace the body
// with the real `<ArchiveLeagueAction league={league} .../>` etc. once
// those components exist — the row already has every field
// `LeagueActionTarget` needs, computed once per league above.
function LeagueRowActions({ league }: { league: LeagueActionTarget }) {
  void league;
  return null;
}
