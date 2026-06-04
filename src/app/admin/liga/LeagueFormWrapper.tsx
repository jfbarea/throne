"use client";

// LeagueFormWrapper — thin client component that wraps LeagueForm and
// handles post-save navigation (router.refresh to reload server data).

import { useRouter } from "next/navigation";
import { LeagueForm } from "./LeagueForm";
import type { League } from "@/generated/prisma/client";

interface Props {
  league?: League;
}

export function LeagueFormWrapper({ league }: Props) {
  const router = useRouter();

  function handleSaved(_id: string) {
    // Refresh server component data without a full page reload.
    // _id is received but not used; navigation is handled by router.refresh().
    void _id;
    router.refresh();
  }

  return <LeagueForm league={league} onSaved={handleSaved} />;
}
