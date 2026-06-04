"use client";

// ResetLeagueButton — danger-zone control that wipes the competition
// (matches, results, bracket) and returns the league to SETUP. Players and
// configuration are kept. Two-step confirmation to prevent accidents.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Toast } from "@/components/Toast";
import { Warning } from "@phosphor-icons/react";
import { resetLeague } from "@/server/league-actions";

export function ResetLeagueButton({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{
    id: number;
    type: "error" | "success";
    message: string;
  } | null>(null);

  function notify(type: "error" | "success", message: string) {
    setToast((prev) => ({ id: (prev?.id ?? 0) + 1, type, message }));
  }

  function handleReset() {
    startTransition(async () => {
      const res = await resetLeague(leagueId);
      if (res.ok) {
        setConfirming(false);
        notify("success", "Liga reiniciada. Vuelve a generar los emparejamientos.");
        router.refresh();
      } else {
        notify("error", res.error);
      }
    });
  }

  return (
    <div
      className="rounded-[var(--radius-sm)] p-4"
      style={{
        border: "1px solid rgba(184,92,60,0.35)",
        background: "rgba(184,92,60,0.06)",
      }}
    >
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div className="flex items-start gap-2 mb-3">
        <Warning
          size={18}
          weight="fill"
          style={{ color: "var(--danger)" }}
          className="mt-[1px] shrink-0"
        />
        <div>
          <p
            className="text-[14px] font-semibold"
            style={{ color: "var(--fg)", fontFamily: "var(--font-sans)" }}
          >
            Reiniciar la liga
          </p>
          <p
            className="mt-0.5 text-[12px] leading-[17px]"
            style={{ color: "var(--fg-muted)", fontFamily: "var(--font-sans)" }}
          >
            Borra todas las partidas, resultados y el bracket de playoffs, y
            devuelve la liga a estado de configuración. Se conservan los
            jugadores y la configuración. Esta acción no se puede deshacer.
          </p>
        </div>
      </div>

      {!confirming ? (
        <Button
          variant="danger"
          onClick={() => setConfirming(true)}
          icon={<Warning size={16} />}
        >
          Reiniciar la liga
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-[13px] font-semibold"
            style={{ color: "var(--danger)", fontFamily: "var(--font-sans)" }}
          >
            ¿Seguro? Esto es irreversible.
          </span>
          <Button variant="danger" onClick={handleReset} disabled={isPending}>
            {isPending ? "Reiniciando…" : "Sí, reiniciar"}
          </Button>
          <Button
            variant="ghost"
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
