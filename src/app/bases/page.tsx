// /bases — the old unslugged public rules page. multi-liga spec §2.11,
// §4.3: it never lists leagues, and it never renders bases itself anymore
// (that's /liga/[slug]/bases now); it only resolves where to send whoever
// asks, the same way every other unslugged route does (§4.3):
//
//   cookie.playerId → Player.leagueId → League.slug → /liga/<slug>/bases
//
// role === "ADMIN" cuts the branch before any query, same as every other
// old route (spec §4.3). The one case with no session AT ALL to resolve
// from is unique to this route (every other old route requires a session):
// with exactly one league in circulation this still has to work with zero
// clicks (§7.1 continuity — the deploy-day bookmark), with anything else it
// can't guess, and must never list.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { LinkConcretoScreen } from "./LinkConcretoScreen";

export default async function BasesIndexPage() {
  const session = await getSession();

  if (session?.role === "ADMIN") {
    redirect("/admin");
  }

  if (session) {
    // PLAYER session.
    const player = session.playerId
      ? await prisma.player.findUnique({
          where: { id: session.playerId },
          select: { league: { select: { slug: true, archivedAt: true } } },
        })
      : null;

    if (!player) {
      // Their Player row no longer resolves (spec §5.2: their league was
      // deleted) — nothing to redirect them "back" to.
      redirect("/login");
    }

    if (player.league.archivedAt !== null) {
      // Spec §5.3: a league archived after login signs the player out on
      // their next request, same precedent as requireLeagueAccess
      // (src/lib/league-context.ts).
      redirect("/login");
    }

    redirect(`/liga/${player.league.slug}/bases`);
  }

  // No session at all. Never list leagues (spec §2.11) — with exactly one
  // league in circulation there's a single unambiguous answer; with zero or
  // two-or-more there isn't, and the deploy-day bookmark falls back to
  // asking for the specific link instead of guessing (or listing).
  const circulating = await prisma.league.findMany({
    where: { archivedAt: null },
    select: { slug: true },
    take: 2,
  });

  if (circulating.length === 1) {
    redirect(`/liga/${circulating[0].slug}/bases`);
  }

  return <LinkConcretoScreen />;
}
