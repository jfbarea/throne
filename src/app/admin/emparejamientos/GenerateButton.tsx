"use client";

// Client component: button that calls generateLeagueMatches server action.
// Shows loading state, error and success messages inline.

import { useState, useTransition } from "react";
import { Button } from "@/components";
import { generateLeagueMatches } from "@/server/match-actions";
import { Shuffle, Warning } from "@phosphor-icons/react";

interface GenerateButtonProps {
  leagueId: string;
  hasConfirmedMatches: boolean;
  currentMatchCount: number;
}

export function GenerateButton({
  leagueId,
  hasConfirmedMatches,
  currentMatchCount,
}: GenerateButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function handleGenerate() {
    setMessage(null);
    startTransition(async () => {
      const result = await generateLeagueMatches(leagueId);
      if (result.ok) {
        setMessage({
          type: "success",
          text: `Emparejamientos generados: ${result.data.count} partida${result.data.count !== 1 ? "s" : ""} creadas.`,
        });
      } else {
        setMessage({ type: "error", text: result.error });
      }
    });
  }

  const label =
    currentMatchCount > 0 ? "Regenerar emparejamientos" : "Generar emparejamientos";

  return (
    <div className="space-y-3">
      {hasConfirmedMatches && (
        <div
          className="flex items-start gap-2 rounded p-3 text-[13px]"
          style={{
            background: "rgba(220,85,0,0.10)",
            border: "1px solid rgba(220,85,0,0.25)",
            color: "var(--danger)",
            fontFamily: "var(--font-sans)",
          }}
        >
          <Warning size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            Hay partidas con resultado confirmado. No se pueden regenerar los
            emparejamientos.
          </span>
        </div>
      )}

      <Button
        variant="primary"
        icon={<Shuffle size={16} />}
        onClick={handleGenerate}
        disabled={isPending || hasConfirmedMatches}
      >
        {isPending ? "Generando…" : label}
      </Button>

      {currentMatchCount > 0 && !hasConfirmedMatches && (
        <p
          className="text-[12px]"
          style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
        >
          Regenerar descartará las {currentMatchCount} partida
          {currentMatchCount !== 1 ? "s" : ""} actuales (incluyendo fechas
          acordadas).
        </p>
      )}

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
