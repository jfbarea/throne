"use client";

// LeagueFormWrapper — thin client component that wraps LeagueForm and
// handles post-save navigation.
//
// Multi-liga B2 (renombrado-y-liga-no-encontrada, spec §2.6, criterio 21):
// renaming a league recomputes its slug, which is also this very page's URL
// segment. A plain `router.refresh()` after a rename would re-run this page
// under the now-stale slug and hit the "liga no encontrada" screen — so
// instead we navigate to the fresh `/admin/<slug>/liga` whenever the saved
// slug differs from the one we're currently on.

import { useRouter } from "next/navigation";
import { LeagueForm } from "./LeagueForm";
import type { League } from "@/generated/prisma/client";

interface Props {
  league: League;
}

export function LeagueFormWrapper({ league }: Props) {
  const router = useRouter();

  function handleSaved({ slug }: { slug: string }) {
    if (slug !== league.slug) {
      router.push(`/admin/${slug}/liga`);
      return;
    }
    // Refresh server component data without a full page reload.
    router.refresh();
  }

  return <LeagueForm league={league} onSaved={handleSaved} />;
}
