// /admin/[slug] layout — multi-liga C2 (andamiaje-de-rutas).
// Nests under /admin/layout.tsx (already `requireAdmin()`-gated and already
// rendering AppHeader with active="admin") — this layer only adds the
// league-specific guard and indicator on top. No real pages live here yet —
// lane B adds them (liga, jugadores, emparejamientos, rondas, playoffs) and
// lane E adds `bases`.
//
// Every page under /admin is admin-only with no exception (unlike
// /liga/[slug], which has to stay reachable without a session for its
// public `bases` page) — so, unlike that layout, this one can safely require
// an ADMIN session unconditionally before resolving anything.
import { requireAdmin } from "@/lib/guards";
import {
  requireLeagueAccess,
  LeagueNotFoundForAdminError,
} from "@/lib/league-context";
import { LeagueIndicator } from "@/components/LeagueIndicator";
import { LeagueNotFoundScreen } from "@/components/LeagueNotFoundScreen";

export default async function AdminLeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await requireAdmin();

  // JSX is deliberately never constructed inside this try/catch (React
  // doesn't render synchronously, so a lint rule flags it as misleading) —
  // it only resolves data or records which fallback to show; every `return`
  // that builds JSX happens after the block, unconditionally.
  let league: Awaited<ReturnType<typeof requireLeagueAccess>> | null = null;
  let notFoundSlug: string | null = null;
  try {
    // For an ADMIN session `requireLeagueAccess` either returns the league
    // (own, ajena or archivada — all full read access; write actions guard
    // themselves via `assertLeagueWritable`) or throws
    // `LeagueNotFoundForAdminError` — it never redirects for this role.
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
