// /liga/[slug] layout — multi-liga C2 (andamiaje-de-rutas), corrected in I2
// (auditoria-de-cierre) — see the PLAYER branch below for what changed and
// why.
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

  // No session OR a PLAYER session: resolve the league for display only,
  // never redirect from here.
  //
  // I2 fix (bug 1, found at cierre): this used to call
  // `requireLeagueAccess(slug, session)` for a PLAYER session too, WITHOUT
  // `samePagePath` — every page under this segment (lane A's five, spec
  // criterio 5) already calls `requireLeagueAccess(slug, session, "<page>")`
  // itself, precisely so a silent redirect lands on the *same* page in the
  // player's own league. But a layout is the parent of the page in Next's
  // render tree, and a parent Server Component's `redirect()` always wins:
  // it throws and aborts the render before the child page's own function is
  // ever invoked, so the page's `samePagePath` call never got a chance to
  // run. The layout's generic redirect (no `samePagePath`) was the one
  // actually firing, landing a PLAYER of A requesting `/liga/<slug-B>/
  // clasificacion` on `/liga/<slug-A>` — the bare root, which itself
  // redirects to `mis-partidas` — instead of `/liga/<slug-A>/clasificacion`
  // (spec criterio 5, "acaba en... la MISMA página"). No data leaked (the
  // redirect still went to the player's own league), but the destination
  // page was wrong.
  //
  // Fix: don't enforce access here for a PLAYER at all — resolve the league
  // purely for `LeagueIndicator`'s display, exactly like the no-session
  // case, and let each page's own `requireLeagueAccess(slug, session,
  // "<page>")` call be the *only* one that can redirect. That's safe even
  // when the resolved league is a foreign one (briefly rendered into the
  // indicator before the page below redirects): this route has no
  // Suspense/`loading.tsx` boundary, so nothing is streamed to the client
  // until the whole tree finishes — a `redirect()` thrown anywhere in it
  // (the nested page, in the normal case) discards the entire render,
  // indicator included, in favor of the redirect response. It never reaches
  // the client. Verified by tests/layout-y-pagina-en-serie.test.ts, which
  // renders the layout with a *real* page component (not an opaque marker)
  // nested inside, the same shape Next.js actually builds.
  if (!session || session.role === "PLAYER") {
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

  // ADMIN session: unchanged. `requireLeagueAccess` never redirects for
  // ADMIN — it either returns the league (own, ajena or archivada, all full
  // read access) or throws `LeagueNotFoundForAdminError`, which is
  // page-independent (spec §5.1's "esa liga no existe" screen is the same
  // regardless of which page under the segment was requested), so there's
  // no `samePagePath` to lose here.
  //
  // JSX is deliberately never constructed inside this try/catch (React
  // doesn't render synchronously, so a lint rule flags it as misleading) —
  // it only resolves data or records which fallback to show; every `return`
  // that builds JSX happens after the block, unconditionally.
  let league: Awaited<ReturnType<typeof requireLeagueAccess>> | null = null;
  let notFoundSlug: string | null = null;
  try {
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
