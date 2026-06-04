"use client";

// ConfirmActions — buttons for the RIVAL to confirm or dispute a reported result.
// SPEC §7.5 step 2: anti-dispute flow.

import { useState, useTransition } from "react";
import { Button } from "@/components";
import { confirmResult, disputeResult } from "@/server/result-actions";
import { Check, Warning } from "@phosphor-icons/react";

interface ConfirmActionsProps {
  matchId: string;
  onDone?: () => void;
}

export function ConfirmActions({ matchId, onDone }: ConfirmActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await confirmResult(matchId);
      if (res.ok) {
        onDone?.();
      } else {
        setError(res.error);
      }
    });
  }

  function handleDispute() {
    setError(null);
    startTransition(async () => {
      const res = await disputeResult(matchId);
      if (res.ok) {
        onDone?.();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div
      className="mt-3 p-3 rounded space-y-2"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
      }}
    >
      <p
        className="text-[12px]"
        style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
      >
        Tu rival ha reportado el resultado. ¿Estás de acuerdo?
      </p>

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
          icon={<Check size={14} />}
          onClick={handleConfirm}
          disabled={isPending}
        >
          {isPending ? "Confirmando…" : "Confirmar resultado"}
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={<Warning size={14} />}
          onClick={handleDispute}
          disabled={isPending}
        >
          {isPending ? "Disputando…" : "Disputar"}
        </Button>
      </div>
    </div>
  );
}
