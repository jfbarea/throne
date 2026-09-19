// Shared redirect logic for the five legacy, unslugged player routes
// (`/clasificacion`, `/calendario`, `/rondas`, `/bracket`, `/mis-partidas`),
// multi-liga A2 (redirecciones-de-rutas-antiguas), spec §4.3, §5.10:
//
//     cookie.playerId → Player.leagueId → League.slug → /liga/<slug>/<page>
//
// A private module under `src/app/_lib` (the `_` prefix makes Next.js treat
// this whole folder as a non-route "private folder", per App Router
// convention) rather than `src/lib/`: this logic only exists to serve these
// five page.tsx files (Lane A's own), not a contract other lanes consume —
// unlike `src/lib/league-context.ts` (C1, frozen after C2).
//
// Deliberately does NOT reuse `requireLeagueAccess` (src/lib/league-context.ts):
// that helper always resolves a `slug` argument first (one query) before
// even looking at the session, which would cost a second, wasted query here
// (there's no "requested slug" on these routes to check against — every
// legacy request is, by construction, an unconditional "send them to their
// own league"). Spec criterio 5 (A2 hito) requires exactly one query for a
// PLAYER session, and none at all for ADMIN or no session — a hand-rolled,
// single `Player.findUnique` does that directly.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/**
 * Redirect the current request to `pagePath` (e.g. "clasificacion") within
 * the requesting PLAYER's own league. Never returns — every branch ends in
 * `redirect()`, which aborts rendering by throwing.
 *
 * Branches (spec §4.3):
 *  - No session → `/login`. Zero queries.
 *  - ADMIN session → `/admin`, unconditionally — there's no "their league"
 *    for an admin to fall back to (multi-liga spec §2.3). Zero queries: the
 *    role check alone decides it, before touching the database.
 *  - PLAYER session whose `Player` row no longer resolves (their league was
 *    deleted, spec §5.2) or whose league is archived (spec §5.3) → `/login`,
 *    same as `requireLeagueAccess`'s equivalent branches: signs them out as
 *    a best effort without clearing the cookie (Server Components can't
 *    mutate cookies mid-render; making this terminal is lane D/C's job once
 *    archiving/deletion ship, same note as league-context.ts).
 *  - PLAYER session, ordinary case → `/liga/<their-slug>/<pagePath>`. One
 *    query.
 */
export async function redirectToOwnLeaguePage(
  pagePath: string
): Promise<never> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (session.role === "ADMIN") {
    redirect("/admin");
  }

  const player = session.playerId
    ? await prisma.player.findUnique({
        where: { id: session.playerId },
        select: { league: { select: { slug: true, archivedAt: true } } },
      })
    : null;

  if (!player || player.league.archivedAt !== null) {
    redirect("/login");
  }

  redirect(`/liga/${player.league.slug}/${pagePath}`);
}
