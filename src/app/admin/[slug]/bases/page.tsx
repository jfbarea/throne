// /admin/[slug]/bases — edit the free-form prose of a league's bases.
// multi-liga spec §2.11, §4.11. Nested under /admin/[slug]/layout.tsx
// (C2, admin-only, already resolved & guarded the league — an ADMIN session
// reaching this file always has a real, existing league behind `slug`).
import { resolveLeagueBySlug } from "@/lib/league-context";
import { Eyebrow } from "@/components";
import { BasesRulesForm } from "./BasesRulesForm";

export default async function AdminBasesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // The layout already resolved and guarded this exact slug for an ADMIN
  // session (full access, own/ajena/archivada alike) — this is the same
  // React-`cache()`-deduplicated call, not a second query (src/lib/
  // league-context.ts).
  const league = await resolveLeagueBySlug(slug);

  if (!league) {
    // Unreachable in practice: the parent layout already renders
    // LeagueNotFoundScreen instead of this page for a slug that doesn't
    // resolve. Kept only so this component has a total, TypeScript-correct
    // return for `league`.
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Administración · Bases</Eyebrow>
        <h1
          className="mt-2 text-[28px] leading-tight font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg)" }}
        >
          Bases de la liga
        </h1>
        <p
          className="mt-1 text-[13px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          {league.name} · {league.season}
        </p>
      </div>

      <BasesRulesForm
        leagueId={league.id}
        initialRulesMarkdown={league.rulesMarkdown}
        archived={league.archivedAt !== null}
        league={{
          pointsWin: league.pointsWin,
          pointsDraw: league.pointsDraw,
          pointsLoss: league.pointsLoss,
          bonusEnabled: league.bonusEnabled,
          bonusMarginThreshold: league.bonusMarginThreshold,
          bonusMinVP: league.bonusMinVP,
          matchesPerRound: league.matchesPerRound,
          playoffSize: league.playoffSize,
          tiebreakers: league.tiebreakers,
        }}
      />
    </div>
  );
}
