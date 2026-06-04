"use client";

// Client component: button that calls addMissingLeagueMatches server action.
// Shows loading state, error and success messages inline.
// Analogue to GenerateButton but for the incremental "add missing" action.

import { useState, useTransition } from "react";
import { Button } from "@/components";
import { addMissingLeagueMatches } from "@/server/match-actions";
import { PlusCircle } from "@phosphor-icons/react";

interface SyncButtonProps {
  leagueId: string;
  missingCount: number;
}

export function SyncButton({ leagueId, missingCount }: SyncButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function handleSync() {
    setMessage(null);
    startTransition(async () => {
      const result = await addMissingLeagueMatches(leagueId);
      if (result.ok) {
        setMessage({
          type: "success",
          text:
            result.data.count === 0
              ? "No faltaba ninguna partida."
              : `Añadidas ${result.data.count} partida${result.data.count !== 1 ? "s" : ""}.`,
        });
      } else {
        setMessage({ type: "error", text: result.error });
      }
    });
  }

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        icon={<PlusCircle size={16} />}
        onClick={handleSync}
        disabled={isPending || missingCount === 0}
      >
        {isPending
          ? "Añadiendo…"
          : missingCount === 0
            ? "No falta ninguna partida"
            : `Añadir ${missingCount} partida${missingCount !== 1 ? "s" : ""} que falta${missingCount !== 1 ? "n" : ""}`}
      </Button>

      {message && (
        <div
          className="rounded p-3 text-[13px]"
          style={{
            background:
              message.type === "success"
                ? "rgba(76,153,85,0.12)"
                : "rgba(220,85,0,0.10)",
            border: `1px solid ${message.type === "success" ? "rgba(76,153,85,0.30)" : "rgba(220,85,0,0.25)"}`,
            color:
              message.type === "success" ? "var(--success)" : "var(--danger)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
