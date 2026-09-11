"use client";

// UnarchiveLeagueAction — admin-index action component (multi-liga D1,
// archivado-de-ligas). Built against the contract fixed in C2
// (./league-actions-contract.ts); lane B mounts this from /admin/page.tsx.
// spec §2.8, §4.7, §5.4, criterio 25.

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { unarchiveLeague } from "@/server/league/lifecycle";
import type { UnarchiveLeagueActionProps } from "./league-actions-contract";

export function UnarchiveLeagueAction({
  league,
  onUnarchived,
}: UnarchiveLeagueActionProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Only offered for an archived league — archiveLeague is the opposite
  // action (contract docstring).
  if (league.archivedAt === null) {
    return null;
  }

  function handleUnarchive() {
    setError(null);
    startTransition(async () => {
      const result = await unarchiveLeague(league.id);
      if (!result.ok) {
        // Name-collision failures (spec §5.4) are surfaced here, not
        // resolved by this component — there is no partial-desarchivado.
        setError(result.error);
        return;
      }
      onUnarchived?.();
    });
  }

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleUnarchive}
        disabled={isPending}
        icon={<ArrowCounterClockwise size={14} />}
      >
        {isPending ? "Desarchivando…" : "Desarchivar"}
      </Button>
      {error && (
        <p
          className="text-[12px] leading-[16px]"
          style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
