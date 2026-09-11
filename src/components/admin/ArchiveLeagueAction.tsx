"use client";

// ArchiveLeagueAction — admin-index action component (multi-liga D1,
// archivado-de-ligas). Built against the contract fixed in C2
// (./league-actions-contract.ts); lane B mounts this from /admin/page.tsx.
// spec §2.8, §4.7, criterio 22.

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Toast } from "@/components/Toast";
import { Archive } from "@phosphor-icons/react";
import { archiveLeague } from "@/server/league/lifecycle";
import type { ArchiveLeagueActionProps } from "./league-actions-contract";

export function ArchiveLeagueAction({
  league,
  onArchived,
}: ArchiveLeagueActionProps) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Disabled/absent for an already-archived league — unarchiveLeague is the
  // opposite action, not a toggle of this one (contract docstring).
  if (league.archivedAt !== null) {
    return null;
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveLeague(league.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      setError(null);
      onArchived?.();
    });
  }

  return (
    <div>
      {error && (
        <Toast message={error} type="error" onClose={() => setError(null)} />
      )}

      {!confirming ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(true)}
          icon={<Archive size={14} />}
        >
          Archivar
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-[12px] font-semibold"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            ¿Archivar «{league.name}»?
          </span>
          <Button
            variant="danger"
            size="sm"
            onClick={handleArchive}
            disabled={isPending}
          >
            {isPending ? "Archivando…" : "Sí, archivar"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}
