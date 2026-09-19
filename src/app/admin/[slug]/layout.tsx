// /admin/[slug] layout — multi-liga C2 (andamiaje-de-rutas), chrome and
// links completed in B1 (indice-de-ligas-y-pantallas-con-slug).
// No real pages lived here at C2 time — lane B added them (liga, jugadores,
// emparejamientos, rondas, playoffs) and lane E adds `bases`.
//
// Every page under /admin is admin-only with no exception (unlike
// /liga/[slug], which has to stay reachable without a session for its
// public `bases` page) — so, unlike that layout, this one can safely require
// an ADMIN session unconditionally before resolving anything.
//
// Owns the full page chrome (AppHeader + main wrapper + footer) for every
// page scoped to a league: it's the one place in the `/admin` tree that
// actually has the slug in hand, which AppHeader needs to build its
// league-scoped nav links (spec §2.3, §4.10) — see `/admin/layout.tsx` for
// why that chrome isn't rendered one level up instead.
import { requireAdmin } from "@/lib/guards";
import {
  requireLeagueAccess,
  LeagueNotFoundForAdminError,
} from "@/lib/league-context";
import { AppHeader } from "@/components/AppHeader";
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
    // No `leagueSlug` passed to AppHeader on purpose: the slug in the URL
    // never resolved, so there is no league to scope the nav links to
    // (spec §5.1, B2 — LeagueNotFoundScreen itself lists what's available).
    return (
      <PageShell>
        <LeagueNotFoundScreen slug={notFoundSlug} />
      </PageShell>
    );
  }

  return (
    <PageShell leagueSlug={slug}>
      <LeagueIndicator
        name={league!.name}
        season={league!.season}
        archivedAt={league!.archivedAt}
      />
      {children}
    </PageShell>
  );
}

function PageShell({
  children,
  leagueSlug,
}: {
  children: React.ReactNode;
  leagueSlug?: string;
}) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <AppHeader active="admin" leagueSlug={leagueSlug} />

      <main className="flex-1 px-4 py-6 max-w-4xl mx-auto w-full">
        {children}
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
