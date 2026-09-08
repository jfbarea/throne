"use client";

// Client component: "Cerrar ronda N" button.
// Rondas-con-fecha spec §4.7, §5.7: disabled until the round's deadline has
// arrived — there is no forced-close path, only moving the deadline first
// (EditDeadlineForm) and closing after. Shows the pending count so the admin
// knows how many matches are about to be settled as 0-0 before pulling the
// trigger. Hito 4: cierre-de-ronda.
//
// `isPastDeadline` and `deadlineLabel` are computed by the server component
// (page.tsx) rather than here: comparing against "now" is an impure read
// that belongs in render-time server data, not in a client component body
// (react-hooks/purity forbids calling Date.now() during render).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { closeRound } from "@/server/round-actions";
import { Lock } from "@phosphor-icons/react";

interface CloseRoundButtonProps {
  roundId: string;
  roundIndex: number;
  isPastDeadline: boolean;
  /** Pre-formatted deadline date, shown only while disabled. */
  deadlineLabel: string;
  /** How many matches in this round still have no Result. */
  pendingCount: number;
}

export function CloseRoundButton({
  roundId,
  roundIndex,
  isPastDeadline,
  deadlineLabel,
  pendingCount,
}: CloseRoundButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function handleClose() {
    setMessage(null);
    startTransition(async () => {
      const result = await closeRound(roundId);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({
        type: "success",
        text: `Ronda cerrada. ${result.data.settledCount} partida${
          result.data.settledCount !== 1 ? "s" : ""
        } saldada${result.data.settledCount !== 1 ? "s" : ""} 0-0.`,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant="danger"
        disabled={!isPastDeadline || isPending}
        onClick={handleClose}
        icon={<Lock size={14} />}
      >
        {isPending ? "Cerrando…" : `Cerrar ronda ${roundIndex}`}
      </Button>
      <span
        className="text-[12px]"
        style={{ color: "var(--fg-faint)", fontFamily: "var(--font-sans)" }}
      >
        {isPastDeadline
          ? `Se saldarán ${pendingCount} partida${pendingCount !== 1 ? "s" : ""} sin resultado.`
          : `Se podrá cerrar a partir del ${deadlineLabel}.`}
      </span>
      {message && (
        <span
          className="text-[12px] font-semibold"
          style={{
            color:
              message.type === "success" ? "var(--success)" : "var(--danger)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
