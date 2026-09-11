// /liga/[slug] — bare segment, no dedicated view of its own.
//
// Exists only as a landing spot: `/liga/[slug]/layout.tsx` (C2) redirects a
// PLAYER session here (`buildOwnLeaguePath` with no `samePagePath`,
// src/lib/league-context.ts) whenever it catches them requesting a league
// that isn't theirs or doesn't exist at all — that redirect target has no
// page-specific segment to work with (the layout is shared by every route
// under `/liga/[slug]`, it doesn't know which one triggered the guard), so
// without this page that landing would 404 instead of silently working
// (multi-liga spec §4.2, §5.1 — "sin mensaje de error", not a broken link).
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
