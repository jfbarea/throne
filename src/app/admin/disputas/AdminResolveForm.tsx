"use client";

// AdminResolveForm — admin form to resolve a disputed (or any) match.
// SPEC §7.5 step 3: admin override with AuditLog trace.

import { useState, useTransition } from "react";
import { Button } from "@/components";
import { Input } from "@/components";
import { adminResolveResult } from "@/server/result-actions";
import { Check, X } from "@phosphor-icons/react";

type Outcome = "HOME_WIN" | "AWAY_WIN" | "DRAW";

interface AdminResolveFormProps {
  matchId: string;
  playerHomeName: string;
  playerAwayName: string;
  currentHomeVP?: number;
  currentAwayVP?: number;
  currentOutcome?: string;
  onDone?: () => void;
}

export function AdminResolveForm({
  matchId,
  playerHomeName,
  playerAwayName,
  currentHomeVP,
  currentAwayVP,
  currentOutcome,
  onDone,
}: AdminResolveFormProps) {
  const [homeVP, setHomeVP] = useState(
    currentHomeVP !== undefined ? String(currentHomeVP) : ""
  );
  const [awayVP, setAwayVP] = useState(
    currentAwayVP !== undefined ? String(currentAwayVP) : ""
  );
  const [outcome, setOutcome] = useState<Outcome | "">(
    (currentOutcome as Outcome) ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleResolve() {
    setError(null);

    if (!outcome) {
      setError("Selecciona el resultado");
      return;
    }

    const home = parseInt(homeVP, 10);
    const away = parseInt(awayVP, 10);

    if (isNaN(home) || isNaN(away)) {
      setError("Los VP deben ser números enteros");
      return;
    }

    startTransition(async () => {
      const res = await adminResolveResult(matchId, {
        homeVictoryPoints: home,
        awayVictoryPoints: away,
        outcome: outcome as Outcome,
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
        border: "1px solid rgba(220,85,0,0.3)",
      }}
    >
      <p
        className="text-[12px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
      >
        Resolución admin
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label={`VP ${playerHomeName}`}
          type="number"
          min="0"
          value={homeVP}
          onChange={(e) => setHomeVP(e.target.value)}
          placeholder="0"
        />
        <Input
          label={`VP ${playerAwayName}`}
          type="number"
          min="0"
          value={awayVP}
          onChange={(e) => setAwayVP(e.target.value)}
          placeholder="0"
        />
      </div>

      <div className="space-y-1">
        <span
          className="block text-[12px] font-semibold"
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
        >
          Resultado oficial
        </span>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: "HOME_WIN", label: `Victoria ${playerHomeName}` },
              { value: "AWAY_WIN", label: `Victoria ${playerAwayName}` },
              { value: "DRAW", label: "Empate" },
            ] as { value: Outcome; label: string }[]
          ).map((opt) => {
            const selected = outcome === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setOutcome(opt.value)}
                className="px-3 py-[7px] rounded text-[13px] font-semibold border transition-all duration-[120ms] cursor-pointer"
                style={{
                  fontFamily: "var(--font-sans)",
                  background: selected ? "var(--accent)" : "var(--surface)",
                  color: selected ? "var(--ink-900)" : "var(--fg-muted)",
                  borderColor: selected
                    ? "var(--accent)"
                    : "var(--border-strong)",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

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

      <div className="flex gap-2 flex-wrap">
        <Button
          variant="danger"
          size="sm"
          icon={<Check size={14} />}
          onClick={handleResolve}
          disabled={isPending}
        >
          {isPending ? "Resolviendo…" : "Confirmar y resolver"}
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
