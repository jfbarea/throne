// LeagueNotFoundScreen — shown instead of the requested page when an ADMIN
// session requests a slug that resolves to no league at all (multi-liga
// spec §4.2, §5.1). Never shown to a PLAYER session: `requireLeagueAccess`
// (src/lib/league-context.ts) redirects them silently to their own league
// instead of throwing `LeagueNotFoundForAdminError` in the first place.
//
// Deliberately minimal for now (multi-liga C2, andamiaje-de-rutas): just the
// message and a link back to the league index. Spec §5.1 wants "una
// pantalla ... que lista las ligas disponibles (en circulación y
// archivadas)" — that list is lane B's job (B2, renombrado-y-liga-no-
// encontrada, criterio 21), which replaces this component's body with the
// real listing once it lands.

import Link from "next/link";

export function LeagueNotFoundScreen({ slug }: { slug: string }) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-4 px-4 py-16 text-center"
      style={{ color: "var(--fg)" }}
    >
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
      <Link
        href="/admin"
        className="text-[14px] font-semibold no-underline"
        style={{ color: "var(--accent)", fontFamily: "var(--font-sans)" }}
      >
        Ver todas las ligas
      </Link>
    </div>
  );
}
