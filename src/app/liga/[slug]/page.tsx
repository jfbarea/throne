// /liga/[slug] — bare segment, no dedicated view of its own.
//
// Exists only as a landing spot for anyone who requests this exact bare URL
// directly (a typed address, an old bookmark to `/liga/<slug>` with no
// sub-page) — nothing in the app links here on purpose, but Next.js needs a
// real page at this segment or it 404s.
//
// Not reached by the access guard anymore (I2 fix, spec criterio 5):
// `/liga/[slug]/layout.tsx` used to redirect a mismatched PLAYER here
// (`buildOwnLeaguePath` with no `samePagePath`, src/lib/league-context.ts)
// because it couldn't tell which page under the segment triggered the
// guard — that's exactly the bug this fix corrects. Access enforcement for
// a PLAYER now lives entirely in each page's own `requireLeagueAccess(slug,
// session, "<page>")` call, which always lands on the exact page requested,
// never here.
//
// Mirrors `/` (src/app/page.tsx): a player with no more specific page in
// mind lands on their matches.
import { redirect } from "next/navigation";

export default async function LigaRootPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/liga/${slug}/mis-partidas`);
}
