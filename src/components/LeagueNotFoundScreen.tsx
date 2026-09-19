// LeagueNotFoundScreen — shown instead of the requested page when an ADMIN
// session requests a slug that resolves to no league at all (multi-liga
// spec §4.2, §5.1). Never shown to a PLAYER session: `requireLeagueAccess`
// (src/lib/league-context.ts) redirects them silently to their own league
// instead of throwing `LeagueNotFoundForAdminError` in the first place.
//
// Multi-liga B2 (renombrado-y-liga-no-encontrada, spec §5.1, criterio 21):
// completes what C2 (andamiaje-de-rutas) deliberately left minimal — this
// now lists every league the admin can reach (en circulación y archivadas),
// so a renamed or mistyped slug lands on a real way out instead of a dead
// end. Fetches its own data (an admin-only, read-only listing — the same
// shape `/admin/page.tsx` builds for the index) rather than taking it as a
// prop, so neither of this component's two call sites
// (`/admin/[slug]/layout.tsx`, and `/liga/[slug]/layout.tsx` for an ADMIN
// session browsing a player-facing route, lane A) need to fetch and thread
// the list through just to render this fallback.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/Badge";

export async function LeagueNotFoundScreen({ slug }: { slug: string }) {
  const leagues = await prisma.league.findMany({
    orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }],
    select: { slug: true, name: true, season: true, archivedAt: true },
  });
  const enCirculacion = leagues.filter((l) => l.archivedAt === null);
  const archivadas = leagues.filter((l) => l.archivedAt !== null);

  return (
    <div
      className="flex-1 flex flex-col items-center gap-6 px-4 py-16 text-center"
      style={{ color: "var(--fg)" }}
    >
      <div className="flex flex-col items-center gap-2">
        <p
          className="text-[20px] font-semibold"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Esa liga no existe
        </p>
        <p
          className="text-[14px] max-w-[48ch]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          No hay ninguna liga con el slug <code>{slug}</code>. Puede que se
          haya renombrado o borrado.
        </p>
      </div>

      {leagues.length === 0 ? (
        <Link
          href="/admin/nueva"
          className="text-[14px] font-semibold no-underline"
          style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
        >
          Crear la primera liga
        </Link>
      ) : (
        <div className="w-full max-w-[420px] text-left space-y-5">
          {enCirculacion.length > 0 && (
            <LeagueList title="En circulación" leagues={enCirculacion} />
          )}
          {archivadas.length > 0 && (
            <LeagueList title="Archivadas" leagues={archivadas} />
          )}
        </div>
      )}

      <Link
        href="/admin"
        className="text-[13px] no-underline"
        style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
      >
        Ver el índice de ligas →
      </Link>
    </div>
  );
}

function LeagueList({
  title,
  leagues,
}: {
  title: string;
  leagues: { slug: string; name: string; season: string; archivedAt: Date | null }[];
}) {
  return (
    <div>
      <p
        className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2"
        style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
      >
        {title}
      </p>
      <ul className="space-y-1.5">
        {leagues.map((l) => (
          <li key={l.slug}>
            <Link
              href={`/admin/${l.slug}/liga`}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded no-underline"
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-raised)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <span className="min-w-0 truncate">
                <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                  {l.name}
                </span>{" "}
                <span style={{ color: "var(--fg-faint)" }}>· {l.season}</span>
              </span>
              {l.archivedAt !== null && (
                <Badge variant="ash" className="flex-shrink-0">
                  Archivada
                </Badge>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
