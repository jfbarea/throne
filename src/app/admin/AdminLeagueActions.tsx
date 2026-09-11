"use client";

// AdminLeagueActions — mounts lane D's four lifecycle action components
// (src/components/admin/{Archive,Unarchive,Duplicate,Delete}LeagueAction.tsx)
// for a single league row of the `/admin` index.
//
// Multi-liga hito de integración I1: `admin/page.tsx`'s `LeagueRowActions`
// extension point (spec §2.8, §2.9, §2.10) rendered `null` — the four
// components existed, built against the contract fixed in C2
// (src/components/admin/league-actions-contract.ts), but nobody mounted
// them. This is that mount point.
//
// It exists as its own Client Component, separate from `page.tsx`, because
// `page.tsx` is a Server Component (it reads the DB directly) and none of
// its functions can hold `useState`/`useRouter` or receive a closure prop
// from the server. None of the four action components call
// `router.refresh()` themselves (contract: "Called after the server action
// succeeds, so the index page can refresh its list without the component
// needing to know how") — this is the one place that connects their
// `onArchived`/`onUnarchived`/`onDeleted`/`onDuplicated` callbacks to an
// actual refresh.
//
// `onDuplicated` is the one callback that isn't a plain refresh: spec §2.9
// requires the generated passcodes to be shown once
// (DuplicatePasscodesScreen, ./DuplicatePasscodesScreen.tsx) before the
// index reflects the new league.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveLeagueAction } from "@/components/admin/ArchiveLeagueAction";
import { UnarchiveLeagueAction } from "@/components/admin/UnarchiveLeagueAction";
import { DuplicateLeagueAction } from "@/components/admin/DuplicateLeagueAction";
import { DeleteLeagueAction } from "@/components/admin/DeleteLeagueAction";
import type { LeagueActionTarget } from "@/components/admin/league-actions-contract";
import { DuplicatePasscodesScreen } from "./DuplicatePasscodesScreen";

interface AdminLeagueActionsProps {
  league: LeagueActionTarget;
}

export function AdminLeagueActions({ league }: AdminLeagueActionsProps) {
  const router = useRouter();
  const [duplicateResult, setDuplicateResult] = useState<{
    newLeagueSlug: string;
    generatedPasscodes: { displayName: string; plainPasscode: string }[];
  } | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <ArchiveLeagueAction
          league={league}
          onArchived={() => router.refresh()}
        />
        <UnarchiveLeagueAction
          league={league}
          onUnarchived={() => router.refresh()}
        />
        <DuplicateLeagueAction
          league={league}
          onDuplicated={(result) =>
            setDuplicateResult({
              newLeagueSlug: result.newLeagueSlug,
              generatedPasscodes: result.generatedPasscodes,
            })
          }
        />
        <DeleteLeagueAction league={league} onDeleted={() => router.refresh()} />
      </div>

      {duplicateResult && (
        <DuplicatePasscodesScreen
          leagueSlug={duplicateResult.newLeagueSlug}
          passcodes={duplicateResult.generatedPasscodes}
          onClose={() => {
            // The index only needs to pick up the new league once the admin
            // has dismissed the one-time passcode screen (spec §2.9) — not
            // before, or the row for the new league would render behind it.
            setDuplicateResult(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
