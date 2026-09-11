// /liga/[slug] layout — multi-liga C2 (andamiaje-de-rutas).
// Resolves the league from the URL slug and enforces spec §4.2's access
// table for whichever session is active, before any page under this segment
// renders. No real pages live here yet — lane A adds them
// (clasificacion, calendario, rondas, bracket, mis-partidas) and lane E adds
// the public `bases` page.
//
// Deliberately NOT a blanket `requireAuth()` gate (unlike `/admin/layout.tsx`,
// where every page really is admin-only): `/liga/[slug]/bases` is the one
// route in this whole app that's public, without a session (spec §2.11), and
// it lives under this exact segment. Every *other* page under here enforces
// its own `requireAuth()`/`requirePlayer()` first thing — same convention
// pages already follow today for the unslugged routes — so a sessionless
// request simply gets the league resolved as a public read, with no guard
// and no redirect, and the page itself decides what "not found" means for
// it. A session (player or admin) gets the full guard: an unresolved or
// inaccessible slug never reaches the page body.
import { getSession } from "@/lib/session";
import {
  requireLeagueAccess,
  resolveLeagueBySlug,
  LeagueNotFoundForAdminError,
} from "@/lib/league-context";
import { LeagueIndicator } from "@/components/LeagueIndicator";
import { LeagueNotFoundScreen } from "@/components/LeagueNotFoundScreen";

export default async function LigaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getSession();

  if (!session) {
    const league = await resolveLeagueBySlug(slug);
    return (
      <>
        {league && (
          <LeagueIndicator
            name={league.name}
            season={league.season}
            archivedAt={league.archivedAt}
          />
        )}
        {children}
      </>
    );
  }

  // JSX is deliberately never constructed inside this try/catch (React
  // doesn't render synchronously, so a lint rule flags it as misleading) —
  // it only resolves data or records which fallback to show; every `return`
  // that builds JSX happens after the block, unconditionally.
  let league: Awaited<ReturnType<typeof requireLeagueAccess>> | null = null;
  let notFoundSlug: string | null = null;
  try {
    // Never returns for a PLAYER session pointed at a league that isn't
    // theirs (redirects silently instead, spec §4.2) — only an ADMIN
    // session can end up setting `notFoundSlug`, and only via a nonexistent
    // slug.
    league = await requireLeagueAccess(slug, session);
  } catch (err) {
    if (!(err instanceof LeagueNotFoundForAdminError)) {
      throw err;
    }
    notFoundSlug = slug;
  }

  if (notFoundSlug !== null) {
    return <LeagueNotFoundScreen slug={notFoundSlug} />;
  }

  return (
    <>
      <LeagueIndicator
        name={league!.name}
        season={league!.season}
        archivedAt={league!.archivedAt}
      />
      {children}
    </>
  );
}
