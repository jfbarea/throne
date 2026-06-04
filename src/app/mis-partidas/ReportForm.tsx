"use client";

// ReportForm — inline form to report a match result (VP + optional forceDraw).
// The outcome is derived from the VP on the server (SPEC §4.5), not chosen here.
// SPEC §7.5: only participants; identity from server cookie, not client.

import { useState, useTransition } from "react";
import { Button } from "@/components";
import { Input } from "@/components";
import { reportResult } from "@/server/result-actions";
import { Check, X } from "@phosphor-icons/react";

interface ReportFormProps {
  matchId: string;
  playerHomeName: string;
  playerAwayName: string;
  onDone?: () => void;
}

export function ReportForm({
  matchId,
  playerHomeName,
  playerAwayName,
  onDone,
}: ReportFormProps) {
  const [homeVP, setHomeVP] = useState("");
  const [awayVP, setAwayVP] = useState("");
  // Mission-rules draw despite unequal VP — the rare explicit case (SPEC §4.5).
  const [missionDraw, setMissionDraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const home = parseInt(homeVP, 10);
  const away = parseInt(awayVP, 10);
  const vpReady = !isNaN(home) && !isNaN(away);

  // Outcome preview, derived from the VP (matches the server's deriveOutcome).
  let derivedLabel = "";
  if (vpReady) {
    if (missionDraw || home === away) derivedLabel = "Empate";
    else if (home > away) derivedLabel = `Victoria ${playerHomeName}`;
    else derivedLabel = `Victoria ${playerAwayName}`;
  }

  function handleSubmit() {
    setError(null);

    if (!vpReady) {
      setError("Los VP deben ser números enteros");
      return;
    }

    startTransition(async () => {
      const res = await reportResult(matchId, {
        homeVictoryPoints: home,
        awayVictoryPoints: away,
        // Equal VP is already a draw; the flag only matters when VP differ.
        forceDraw: missionDraw,
      });

      if (res.ok) {
        onDone?.();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div
      className="mt-3 p-3 rounded space-y-3"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
      }}
    >
      <p
        className="text-[12px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
      >
        Reportar resultado
      </p>

      {/* VP fields */}
      {/* min-w-0 on each cell overrides the browser default min-width:auto so the
          grid columns can shrink below their content on narrow (390 px) viewports. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <Input
            label={`VP ${playerHomeName}`}
            type="number"
            min="0"
            value={homeVP}
            onChange={(e) => setHomeVP(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="min-w-0">
          <Input
            label={`VP ${playerAwayName}`}
            type="number"
            min="0"
            value={awayVP}
            onChange={(e) => setAwayVP(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>

      {/* Derived result preview — the outcome is inferred from the VP (SPEC §4.5). */}
      <div className="space-y-1">
        <span
          className="block text-[12px] font-semibold"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          Resultado
        </span>
        <p
          className="text-[14px] font-semibold"
          style={{
            color: derivedLabel ? "var(--fg)" : "var(--fg-faint)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {derivedLabel || "Introduce los VP para ver el resultado"}
        </p>
      </div>

      {/* Optional: mission-rules draw despite unequal VP (rare). */}
      <label
        className="flex items-center gap-2 text-[13px] cursor-pointer select-none"
        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
      >
        <input
          type="checkbox"
          checked={missionDraw}
          onChange={(e) => setMissionDraw(e.target.checked)}
        />
        Empate por reglas de misión (aunque los VP difieran)
      </label>

      {/* Error */}
      {error && (
        <p
          className="text-[12px] rounded p-2"
          style={{
            background: "rgba(220,85,0,0.10)",
            border: "1px solid rgba(220,85,0,0.25)",
            color: "var(--danger)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="primary"
          size="sm"
          icon={<Check size={14} />}
          onClick={handleSubmit}
          disabled={isPending}
        >
          {isPending ? "Enviando…" : "Reportar"}
        </Button>
        {onDone && (
          <Button
            variant="ghost"
            size="sm"
            icon={<X size={14} />}
            onClick={onDone}
            disabled={isPending}
          >
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}
