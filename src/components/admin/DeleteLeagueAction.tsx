"use client";

// DeleteLeagueAction — admin-index action component (multi-liga D2,
// crear-duplicar-borrar). Built against the contract fixed in C2
// (./league-actions-contract.ts); lane B mounts this from /admin/page.tsx.
// spec §2.10, §5.7, criterios 31, 32.

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Trash, Warning } from "@phosphor-icons/react";
import { deleteLeague } from "@/server/league/lifecycle";
import type { DeleteLeagueActionProps } from "./league-actions-contract";

export function DeleteLeagueAction({ league, onDeleted }: DeleteLeagueActionProps) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Only ever offered for a league still in SETUP with zero matches (spec
  // §2.10, §5.7) — every other league can only be archived. The server
  // action enforces the same rule; this only decides what to render.
  const isEligible = league.status === "SETUP" && league.matchCount === 0;
  if (!isEligible) {
    return null;
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteLeague(league.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      onDeleted?.();
    });
  }

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        icon={<Trash size={14} />}
      >
        Borrar
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Warning
          size={16}
          weight="fill"
          style={{ color: "var(--danger)" }}
          className="mt-[1px] shrink-0"
        />
        <p
          className="text-[12px] leading-[16px]"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          Se borrará «{league.name}» y a todos sus jugadores. No se puede
          deshacer.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="danger"
          size="sm"
          onClick={handleDelete}
          disabled={isPending}
        >
          {isPending ? "Borrando…" : "Sí, borrar"}
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
