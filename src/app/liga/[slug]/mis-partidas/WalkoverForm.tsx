"use client";

// WalkoverForm — declare a walkover (incomparecencia) by picking a winner.
// Hito 5 (rondas-con-fecha §4.8-§4.10): either participant or admin declares
// it, no rival confirmation needed. The 80-0 score and the bonus-forced-to-0
// are entirely server-side (declareWalkover) — this form only picks the
// winner.

import { useState, useTransition } from "react";
import { Button } from "@/components";
import { declareWalkover } from "@/server/result-actions";
import { X, Flag } from "@phosphor-icons/react";

interface WalkoverFormProps {
  matchId: string;
  playerHomeId: string;
  playerAwayId: string;
  playerHomeName: string;
  playerAwayName: string;
  onDone?: () => void;
}

export function WalkoverForm({
  matchId,
  playerHomeId,
  playerAwayId,
  playerHomeName,
  playerAwayName,
  onDone,
}: WalkoverFormProps) {
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    if (!winnerId) {
      setError("Elige quién se lleva la incomparecencia");
      return;
    }

    startTransition(async () => {
      const res = await declareWalkover(matchId, { winnerId });
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
        Declarar incomparecencia
      </p>
      <p
        className="text-[13px]"
        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
      >
        Se registra un 80-0 a favor de quien elijas. Úsalo solo si ya
        acordasteis fuera de la app quién gana.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {[
          { id: playerHomeId, name: playerHomeName },
          { id: playerAwayId, name: playerAwayName },
        ].map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setWinnerId(p.id)}
            className="px-3 py-[9px] rounded text-[13px] font-semibold border transition-colors duration-[120ms] cursor-pointer"
            style={{
              background: winnerId === p.id ? "var(--accent)" : "transparent",
              borderColor:
                winnerId === p.id ? "var(--accent)" : "var(--border-strong)",
              color: winnerId === p.id ? "var(--bg)" : "var(--fg-muted)",
              fontFamily: "var(--font-sans)",
            }}
          >
            Gana {p.name}
          </button>
        ))}
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
          variant="primary"
          size="sm"
          icon={<Flag size={14} />}
          onClick={handleSubmit}
          disabled={isPending || !winnerId}
        >
          {isPending ? "Enviando…" : "Declarar"}
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
